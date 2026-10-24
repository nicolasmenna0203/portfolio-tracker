// Calendario de cobros: dividendos, renta y amortización de bonos, balances.
//
// Dos decisiones que definen los montos que se muestran acá:
// - el yield se deriva del endpoint chart, sin request extra ni crumb:
//   docs/decisiones/0008-yahoo-cookie-crumb-y-yield-desde-chart.md
// - los dividendos van netos, y qué excluye ese neto:
//   docs/decisiones/0002-retenciones-excluir-comision-depositario.md

import type { EventoCalendario, CalendarioResponse, YieldTicker } from '@/types';
import { fetchBonosArg } from './bonosArg';
import { fetchDividendosFuturos } from './dividendosFuturos';
import { fetchEarningsUsa } from './yahooEarnings';
import { datosAcciones, preciosBonos, preciosBonosArs, mepSpot } from './precios';
import { netoDividendo } from './retenciones';
import { aliasYahoo } from './tickersElegibles';

/** Dividendos ya pagados (histórico real de Yahoo Finance chart). */
async function fetchDividendos(
  ticker: string,
  desde: string,
  hasta: string,
  tenenciaUsd?: number,
  precio?: number,
): Promise<EventoCalendario[]> {
  // El símbolo que pide el proveedor puede diferir del ticker de cartera
  // (BRKB → BRK-B); los eventos se piden por símbolo, pero el evento se
  // reporta con el ticker de cartera, que es el que el usuario reconoce.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(aliasYahoo(ticker))}?range=5y&interval=3mo&events=div`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000), // Yahoo a veces cuelga; no arrastrar toda la request
  });
  if (!res.ok) throw new Error(`Yahoo dividendos (${ticker}): HTTP ${res.status}`);
  const json = await res.json();
  const dividends: Record<string, { amount: number; date: number }> | undefined =
    json?.chart?.result?.[0]?.events?.dividends;
  if (!dividends) return [];

  const desdeTs = new Date(desde + 'T00:00:00Z').getTime() / 1000;
  const hastaTs = new Date(hasta + 'T23:59:59Z').getTime() / 1000;

  return Object.values(dividends)
    .filter((d) => d.date >= desdeTs && d.date <= hastaTs)
    .map((d) => {
      // cobro neto ≈ (tenencia_usd / precio_acción) × dividendo_por_acción, menos retenciones
      const montoEstimado = tenenciaUsd && precio
        ? netoDividendo((tenenciaUsd / precio) * d.amount)
        : undefined;
      return {
        ticker,
        tipo: 'dividendo' as const,
        fecha: new Date(d.date * 1000).toISOString().slice(0, 10),
        // Sin detalle: el dividendo por acción no aporta al lector (la cartera son
        // CEDEARs, no acciones). Lo que importa es el monto neto y el yield.
        ...(montoEstimado != null ? { montoEstimado, monedaMonto: 'USD' } : {}),
      };
    });
}

export async function fetchCalendarioFinanciero(
  tickersUsa: string[],
  tickersArg: string[],
  desde: string,
  hasta: string,
  tenencias: Record<string, number> = {},
): Promise<CalendarioResponse> {
  // Precios de mercado para estimar unidades a partir del valor de cada posición.
  // De acciones/ETFs se trae además el yield trailing 12m (sale de la misma llamada).
  const [datosUsa, pxBonos, pxBonosArs, mep] = await Promise.all([
    datosAcciones(tickersUsa),
    preciosBonos(tickersArg),
    preciosBonosArs(tickersArg),
    mepSpot(),
  ]);
  const pxAcciones: Record<string, number> = {};
  for (const [t, d] of Object.entries(datosUsa)) pxAcciones[t] = d.px;

  // Acciones/ETF USA: dividendos históricos (Yahoo chart) + futuros confirmados (Nasdaq) + balances (Yahoo calendarEvents).
  const tareas: Promise<EventoCalendario[]>[] = tickersUsa.map((t) =>
    fetchDividendos(t, desde, hasta, tenencias[t.toUpperCase()], pxAcciones[t.toUpperCase()]),
  );
  tareas.push(fetchDividendosFuturos(tickersUsa, desde, hasta, tenencias, pxAcciones));
  tareas.push(fetchEarningsUsa(tickersUsa, desde, hasta));
  // Bonos/ONs ARG: renta + amortización (bonistas), con cobro estimado por tenencia/precio.
  tareas.push(fetchBonosArg(tickersArg, desde, hasta, tenencias, pxBonos, pxBonosArs, mep));

  const settled = await Promise.allSettled(tareas);

  const eventos: EventoCalendario[] = [];
  const errores: string[] = [];

  for (const r of settled) {
    if (r.status === 'fulfilled') {
      eventos.push(...r.value);
    } else {
      errores.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
  }

  eventos.sort((a, b) => a.fecha.localeCompare(b.fecha));

  // Yield informativo de las posiciones que pagan dividendos, con el cobro anual
  // neto proyectado. No alimenta ningún evento del calendario: es solo un dato.
  // El yield se expone BRUTO, como lo publica el emisor y como aparece en
  // cualquier screener — a diferencia de los montos, que van netos de retención.
  const yields: YieldTicker[] = Object.entries(datosUsa)
    .filter(([, d]) => d.divAnual > 0)
    .map(([ticker, d]) => {
      const tenenciaUsd = tenencias[ticker];
      return {
        ticker,
        yieldAnual: d.yieldAnual,
        pagos: d.pagos,
        ...(tenenciaUsd ? { cobroAnual: netoDividendo(tenenciaUsd * d.yieldAnual) } : {}),
      };
    })
    .sort((a, b) => b.yieldAnual - a.yieldAnual);

  return { eventos, yields, errores, generatedAt: Date.now() };
}
