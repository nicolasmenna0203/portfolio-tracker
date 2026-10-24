import type { EventoCalendario } from '@/types';
import { getCrumb, UA } from './yahooCrumb';
import { aliasYahoo } from './tickersElegibles';

// Por qué quoteSummary necesita cookie+crumb:
// docs/decisiones/0008-yahoo-cookie-crumb-y-yield-desde-chart.md
//
// Reemplazo de Finnhub para balances: Yahoo Finance calendarEvents da la próxima
// fecha de earnings por ticker + estimación de EPS. Sin API key; requiere una
// cookie de sesión + "crumb" que Yahoo exige para su endpoint quoteSummary
// (ver lib/yahooCrumb.ts, compartido con lib/yahooFundamentals.ts).

interface YahooEarnings {
  earningsDate?: { raw: number; fmt: string }[];
  earningsAverage?: { raw: number };
}

async function fetchEarningsTicker(
  ticker: string,
  cred: { crumb: string; cookie: string },
): Promise<EventoCalendario[]> {
  // aliasYahoo: el ticker de cartera puede no ser el símbolo del proveedor (BRKB → BRK-B).
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(aliasYahoo(ticker))}?modules=calendarEvents&crumb=${encodeURIComponent(cred.crumb)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Cookie: cred.cookie },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Yahoo earnings (${ticker}): HTTP ${res.status}`);
  const json = await res.json();
  const earnings: YahooEarnings | undefined = json?.quoteSummary?.result?.[0]?.calendarEvents?.earnings;
  const fechas = earnings?.earningsDate ?? [];
  if (fechas.length === 0) return [];

  const eps = earnings?.earningsAverage?.raw;
  // Yahoo puede dar un rango (2 fechas); tomamos la primera como estimada.
  return [{
    ticker,
    tipo: 'earnings' as const,
    fecha: fechas[0].fmt,
    detalle: eps != null ? `EPS est. ${eps.toFixed(2)}` : undefined,
  }];
}

/**
 * Próxima fecha de balance (earnings) de cada ticker USA, dentro del rango pedido.
 * Devuelve [] si no se pudo obtener el crumb (no rompe el resto del calendario).
 */
export async function fetchEarningsUsa(
  tickers: string[],
  desde: string,
  hasta: string,
): Promise<EventoCalendario[]> {
  if (tickers.length === 0) return [];
  const cred = await getCrumb();
  if (!cred) return [];

  const settled = await Promise.allSettled(tickers.map((t) => fetchEarningsTicker(t, cred)));
  const eventos: EventoCalendario[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      for (const e of r.value) {
        if (e.fecha >= desde && e.fecha <= hasta) eventos.push(e);
      }
    }
  }
  return eventos;
}
