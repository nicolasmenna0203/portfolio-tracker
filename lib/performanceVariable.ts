// Por qué un fondo CAFCI puede aparecer en esta lista, y qué significa `esFci`:
// docs/decisiones/0020-fuente-de-precio-por-naturaleza-del-instrumento.md

import type { HistoricoResponse, PerformanceVariableResponse, PrecioHistoricoPunto, RangoHistorico, StockPerformance } from '@/types';
import { datosAcciones } from './precios';
import { fetchFundamentals } from './yahooFundamentals';
import { fetchFciMetricsRentaVariable } from './fciCocos';
import { aliasYahoo } from './tickersElegibles';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36';

/**
 * Junta precio/yield real (datosAcciones, Yahoo chart) con fundamentals
 * (P/E, market cap, rango 52 semanas, variación 1D vía quoteSummary) para el
 * universo de acciones/CEDEARs/ETF de la cartera actual. Tickers sin dato en
 * ninguna de las dos fuentes se omiten del resultado en vez de romperlo.
 *
 * `tickersFci` son posiciones de renta variable que en realidad son fondos
 * CAFCI (no cotizan en Yahoo): se resuelven contra la planilla y entran a la
 * misma lista con `esFci`, para que el total del tab cierre con el Resumen.
 * Sin esto quedaban fuera de las dos pestañas y su valor no sumaba en ninguna.
 */
export async function fetchPerformanceVariable(
  tickersUsa: string[],
  tenencias: Record<string, number> = {},
  tickersFci: string[] = [],
): Promise<PerformanceVariableResponse> {
  const [datos, fundamentals, fciMetrics] = await Promise.all([
    datosAcciones(tickersUsa),
    fetchFundamentals(tickersUsa),
    // La planilla es una sola descarga cacheada; si falla, las acciones
    // normales no se pierden por eso.
    tickersFci.length > 0
      ? fetchFciMetricsRentaVariable().catch(() => new Map())
      : Promise.resolve(new Map()),
  ]);

  const acciones: StockPerformance[] = [];

  for (const ticker of tickersFci) {
    const m = fciMetrics.get(ticker.toUpperCase());
    if (!m || !(m.vcp > 0)) continue;
    acciones.push({
      ticker,
      nombre: m.nombreFondo,
      px: m.vcp,
      variacion1d: m.variacionDiaria,
      // El mapeo rendimiento → columna de variación es deliberado: el fondo no
      // tiene serie de precios propia, y así la fila comparte las columnas de
      // la tabla con el resto en vez de necesitar otra vista.
      variacion1m: m.rendimientoMes,
      variacionYtd: m.rendimientoAnio,
      variacion1a: m.rendimiento12Meses,
      peRatio: null,
      marketCap: null,
      fiftyTwoWeekLow: null,
      fiftyTwoWeekHigh: null,
      dividendYield: null,
      esFci: true,
      fciMoneda: m.moneda,
      fciFecha: m.fecha,
      fciRezagado: m.rezagado,
      ...(tenencias[ticker] ? { tenenciaUsd: tenencias[ticker] } : {}),
    });
  }

  for (const ticker of tickersUsa) {
    const d = datos[ticker];
    const f = fundamentals[ticker];
    if (!d && !f) continue;

    const px = d?.px ?? f?.px;
    if (px == null) continue;

    acciones.push({
      ticker,
      nombre: f?.nombre,
      px,
      variacion1d: f?.variacion1d ?? null,
      variacion1m: d?.variacion1m ?? null,
      variacionYtd: d?.variacionYtd ?? null,
      variacion1a: d?.variacion1a ?? null,
      peRatio: f?.peRatio ?? null,
      marketCap: f?.marketCap ?? null,
      fiftyTwoWeekLow: f?.fiftyTwoWeekLow ?? null,
      fiftyTwoWeekHigh: f?.fiftyTwoWeekHigh ?? null,
      // Preferimos el yield trailing-12m real (datosAcciones) al forward yield de Yahoo:
      // misma métrica que ya se muestra en Calendario, evita mostrar dos yields distintos.
      dividendYield: d?.yieldAnual ?? f?.dividendYieldForward ?? null,
      ...(tenencias[ticker] ? { tenenciaUsd: tenencias[ticker] } : {}),
    });
  }
  acciones.sort((a, b) => a.ticker.localeCompare(b.ticker));

  return { acciones, generatedAt: Date.now() };
}

const RANGO_A_PARAMS: Record<RangoHistorico, { range: string; interval: string }> = {
  '1m': { range: '1mo', interval: '1d' },
  '6m': { range: '6mo', interval: '1d' },
  '1a': { range: '1y', interval: '1d' },
  // interval semanal en los rangos largos: evita traer miles de puntos diarios.
  '5a': { range: '5y', interval: '1wk' },
  '10a': { range: '10y', interval: '1wk' },
};

const cacheHistorico = new Map<string, { puntos: PrecioHistoricoPunto[]; ts: number }>();
const CACHE_MS = 60 * 60 * 1000; // 1 hora

/** Histórico de precio de cierre de un ticker, para el gráfico con selector de rango. */
export async function fetchHistoricoTicker(ticker: string, rango: RangoHistorico): Promise<HistoricoResponse> {
  const key = `${ticker}:${rango}`;
  const hit = cacheHistorico.get(key);
  if (hit && Date.now() - hit.ts < CACHE_MS) {
    return { ticker, rango, puntos: hit.puntos, generatedAt: hit.ts };
  }

  const { range, interval } = RANGO_A_PARAMS[rango];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(aliasYahoo(ticker))}?range=${range}&interval=${interval}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Yahoo chart (${ticker}): HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];

  const timestamps: number[] = result?.timestamp ?? [];
  const closesRaw: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
  const puntos: PrecioHistoricoPunto[] = timestamps
    .map((ts, i) => ({ ts, close: closesRaw[i] }))
    .filter((c): c is { ts: number; close: number } => typeof c.close === 'number' && c.close > 0)
    .map((c) => ({ fecha: new Date(c.ts * 1000).toISOString().slice(0, 10), close: c.close }));

  cacheHistorico.set(key, { puntos, ts: Date.now() });
  return { ticker, rango, puntos, generatedAt: Date.now() };
}
