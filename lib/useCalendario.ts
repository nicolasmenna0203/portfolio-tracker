'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { NoticiaItem, EventoCalendario, YieldTicker } from '@/types';

interface UseCalendarioResult {
  noticias: NoticiaItem[];
  eventos: EventoCalendario[];
  yields: YieldTicker[];
  loadingNoticias: boolean;
  loadingEventos: boolean;
  errorNoticias: string | null;
  errorEventos: string | null;
}

/** Trae noticias y eventos de calendario para tickers USA (dividendos/balances) y ARG (renta/amortización). */
export function useCalendario(
  tickers: string[],
  year: number = new Date().getUTCFullYear(),
  tickersArg: string[] = [],
  tenencias: Record<string, number> = {},
): UseCalendarioResult {
  const [noticias, setNoticias] = useState<NoticiaItem[]>([]);
  const [loadingNoticias, setLoadingNoticias] = useState(true);
  const [errorNoticias, setErrorNoticias] = useState<string | null>(null);

  const [eventos, setEventos] = useState<EventoCalendario[]>([]);
  const [yields, setYields] = useState<YieldTicker[]>([]);
  const [loadingEventos, setLoadingEventos] = useState(true);
  const [errorEventos, setErrorEventos] = useState<string | null>(null);

  const pathname = usePathname();
  const apiBase = pathname?.startsWith('/demo') ? '/api/demo' : '/api';

  const tickersKey = tickers.join(',');
  const tickersArgKey = tickersArg.join(',');
  const tenenciasKey = JSON.stringify(tenencias);

  useEffect(() => {
    setLoadingNoticias(true);
    setErrorNoticias(null);
    fetch(`${apiBase}/noticias?tickers=${tickersKey}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setNoticias(json.noticias ?? []);
      })
      .catch((e) => setErrorNoticias(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingNoticias(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickersKey, apiBase]);

  useEffect(() => {
    if (!tickersKey && !tickersArgKey) { setLoadingEventos(false); return; }
    setLoadingEventos(true);
    setErrorEventos(null);

    const pedirAnio = (y: number) =>
      fetch(`${apiBase}/calendario-financiero`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tickers: tickersKey ? tickersKey.split(',') : [],
          tickersArg: tickersArgKey ? tickersArgKey.split(',') : [],
          tenencias: JSON.parse(tenenciasKey),
          year: y,
        }),
      }).then((r) => r.json());

    // También se pide el año siguiente: "Próximo cobro" busca hacia adelante
    // sin importar qué año esté mirando la grilla, y si hoy cae a fin de año
    // el próximo evento real suele estar ahí (sin esto, un dividendo de enero
    // quedaba invisible mientras se navegaba diciembre del año actual).
    Promise.all([pedirAnio(year), pedirAnio(year + 1)])
      .then(([actual, siguiente]) => {
        if (actual.error) throw new Error(actual.error);
        if (siguiente.error) throw new Error(siguiente.error);
        setEventos([...(actual.eventos ?? []), ...(siguiente.eventos ?? [])]);
        // Los yields son los mismos cálculo (tenencia × yield 12m) para ambos
        // años: alcanza con uno.
        setYields(actual.yields ?? []);
      })
      .catch((e) => setErrorEventos(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingEventos(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickersKey, tickersArgKey, tenenciasKey, year, apiBase]);

  return { noticias, eventos, yields, loadingNoticias, loadingEventos, errorNoticias, errorEventos };
}
