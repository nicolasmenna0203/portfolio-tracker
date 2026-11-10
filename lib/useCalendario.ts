'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { CalendarioResponse, EventoCalendario, YieldTicker } from '@/types';

interface UseCalendarioResult {
  eventos: EventoCalendario[];
  yields: YieldTicker[];
  loadingEventos: boolean;
  errorEventos: string | null;
}

// ── Cache en el navegador ────────────────────────────────────────────────────
//
// La pestaña se desmonta al cambiar de sección, así que sin esto cada visita
// volvía a pedir los dos años y mostraba "Cargando…" de nuevo. Se guarda la
// promesa (no solo el resultado) para que la precarga del dashboard y la
// pestaña compartan el mismo request si coinciden.
//
// 10 minutos: los eventos cambian pocas veces por día, y el servidor ya cachea
// las fuentes por horas; esto solo evita repetir el viaje dentro de una sesión.
const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { promesa: Promise<CalendarioResponse>; ts: number; resuelto?: CalendarioResponse }>();

interface Pedido {
  apiBase: string;
  tickers: string[];
  tickersArg: string[];
  tenencias: Record<string, number>;
}

const claveDe = (p: Pedido, year: number) => JSON.stringify([p.apiBase, p.tickers, p.tickersArg, p.tenencias, year]);

/** El resultado ya llegado, si está en cache y vigente: permite pintar sin pasar por "Cargando…". */
function enCache(p: Pedido, year: number): CalendarioResponse | undefined {
  const hit = cache.get(claveDe(p, year));
  return hit && Date.now() - hit.ts < TTL_MS ? hit.resuelto : undefined;
}

function pedirAnio(p: Pedido, year: number): Promise<CalendarioResponse> {
  const clave = claveDe(p, year);
  const hit = cache.get(clave);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.promesa;

  const promesa = fetch(`${p.apiBase}/calendario-financiero`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers: p.tickers, tickersArg: p.tickersArg, tenencias: p.tenencias, year }),
  })
    .then((r) => r.json())
    .then((j) => {
      if (j.error) throw new Error(j.error);
      const entrada = cache.get(clave);
      if (entrada) entrada.resuelto = j;
      return j as CalendarioResponse;
    });
  // Un error no se queda en cache: el próximo intento vuelve a pedir.
  promesa.catch(() => cache.delete(clave));
  cache.set(clave, { promesa, ts: Date.now() });
  return promesa;
}

function apiBaseDe(pathname: string | null): string {
  return pathname?.startsWith('/demo') ? '/api/demo' : '/api';
}

/**
 * Precarga el año en curso y el siguiente en segundo plano, para que la
 * pestaña Calendario abra con los datos ya listos. Mismos parámetros que el
 * hook: si no coinciden, solo se pierde la precarga.
 */
export function precargarCalendario(
  pathname: string | null,
  tickers: string[],
  tickersArg: string[],
  tenencias: Record<string, number>,
  year: number = new Date().getUTCFullYear(),
): void {
  if (tickers.length === 0 && tickersArg.length === 0) return;
  const p = { apiBase: apiBaseDe(pathname), tickers, tickersArg, tenencias };
  pedirAnio(p, year).catch(() => {});
  pedirAnio(p, year + 1).catch(() => {});
}

/** Trae eventos de calendario para tickers USA (dividendos/balances) y ARG (renta/amortización). */
export function useCalendario(
  tickers: string[],
  year: number = new Date().getUTCFullYear(),
  tickersArg: string[] = [],
  tenencias: Record<string, number> = {},
): UseCalendarioResult {
  const [eventos, setEventos] = useState<EventoCalendario[]>([]);
  const [yields, setYields] = useState<YieldTicker[]>([]);
  const [loadingEventos, setLoadingEventos] = useState(true);
  const [errorEventos, setErrorEventos] = useState<string | null>(null);

  const apiBase = apiBaseDe(usePathname());

  const tickersKey = tickers.join(',');
  const tickersArgKey = tickersArg.join(',');
  const tenenciasKey = JSON.stringify(tenencias);

  useEffect(() => {
    if (!tickersKey && !tickersArgKey) { setLoadingEventos(false); return; }
    let vigente = true;

    const p: Pedido = {
      apiBase,
      tickers: tickersKey ? tickersKey.split(',') : [],
      tickersArg: tickersArgKey ? tickersArgKey.split(',') : [],
      tenencias: JSON.parse(tenenciasKey),
    };

    // Con los dos años ya en cache se pinta directo, sin un cuadro de "Cargando…".
    const a0 = enCache(p, year);
    const s0 = enCache(p, year + 1);
    if (a0 && s0) {
      setEventos([...(a0.eventos ?? []), ...(s0.eventos ?? [])]);
      setYields(a0.yields ?? []);
      setErrorEventos(null);
      setLoadingEventos(false);
      return;
    }
    setLoadingEventos(true);
    setErrorEventos(null);

    // También se pide el año siguiente: "Próximo cobro" busca hacia adelante
    // sin importar qué año esté mirando la grilla, y si hoy cae a fin de año
    // el próximo evento real suele estar ahí (sin esto, un dividendo de enero
    // quedaba invisible mientras se navegaba diciembre del año actual). Pero
    // la grilla se muestra apenas llega el año pedido: el siguiente se suma
    // cuando llega, sin hacer esperar a la pantalla.
    const actual = pedirAnio(p, year);
    const siguiente = pedirAnio(p, year + 1);

    actual
      .then((a) => {
        if (!vigente) return;
        setEventos(a.eventos ?? []);
        // Los yields son el mismo cálculo (tenencia × yield 12m) para ambos años: alcanza con uno.
        setYields(a.yields ?? []);
        setLoadingEventos(false);
        return siguiente.then((s) => {
          if (vigente) setEventos([...(a.eventos ?? []), ...(s.eventos ?? [])]);
        });
      })
      .catch((e) => {
        if (!vigente) return;
        setErrorEventos(e instanceof Error ? e.message : String(e));
        setLoadingEventos(false);
      });

    return () => { vigente = false; };
  }, [tickersKey, tickersArgKey, tenenciasKey, year, apiBase]);

  return { eventos, yields, loadingEventos, errorEventos };
}
