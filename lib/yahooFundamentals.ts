import { getCrumb, UA } from './yahooCrumb';
import { aliasYahoo } from './tickersElegibles';

// Por qué quoteSummary necesita cookie+crumb:
// docs/decisiones/0008-yahoo-cookie-crumb-y-yield-desde-chart.md
//
// Fundamentals de renta variable (P/E, market cap, rango 52 semanas, variación
// del día) vía quoteSummary, mismo mecanismo cookie+crumb que ya usa
// lib/yahooEarnings.ts para earnings — validado en vivo que summaryDetail,
// defaultKeyStatistics y price traen estos campos sin más auth que el crumb.

export interface Fundamentals {
  nombre?: string;
  px: number;
  variacion1d: number | null;
  peRatio: number | null;
  marketCap: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
  /** Forward yield que publica Yahoo; usado solo como fallback de datosAcciones(). */
  dividendYieldForward: number | null;
}

interface QuoteSummaryRaw {
  price?: {
    regularMarketPrice?: { raw?: number };
    regularMarketChangePercent?: { raw?: number };
    marketCap?: { raw?: number };
    shortName?: string;
  };
  summaryDetail?: {
    trailingPE?: { raw?: number };
    marketCap?: { raw?: number };
    fiftyTwoWeekLow?: { raw?: number };
    fiftyTwoWeekHigh?: { raw?: number };
    dividendYield?: { raw?: number };
  };
  defaultKeyStatistics?: {
    forwardPE?: { raw?: number };
  };
}

const CACHE_MS = 60 * 60 * 1000; // 1 hora, mismo TTL que datosAcciones (lib/precios.ts)
const cache = new Map<string, { datos: Fundamentals; ts: number }>();

async function fetchFundamentalsTicker(
  ticker: string,
  cred: { crumb: string; cookie: string },
): Promise<Fundamentals | null> {
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit.datos;

  const modules = 'summaryDetail,defaultKeyStatistics,price';
  // aliasYahoo: el ticker de cartera puede no ser el símbolo del proveedor (BRKB → BRK-B).
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(aliasYahoo(ticker))}?modules=${modules}&crumb=${encodeURIComponent(cred.crumb)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Cookie: cred.cookie },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const r: QuoteSummaryRaw | undefined = json?.quoteSummary?.result?.[0];
  const px = r?.price?.regularMarketPrice?.raw;
  if (typeof px !== 'number' || px <= 0) return null;

  // trailingPE puede venir ausente para empresas con ganancias negativas; forwardPE es el fallback usual.
  const peRatio = r?.summaryDetail?.trailingPE?.raw ?? r?.defaultKeyStatistics?.forwardPE?.raw ?? null;

  const datos: Fundamentals = {
    nombre: r?.price?.shortName,
    px,
    variacion1d: r?.price?.regularMarketChangePercent?.raw ?? null,
    peRatio: typeof peRatio === 'number' ? peRatio : null,
    marketCap: r?.summaryDetail?.marketCap?.raw ?? r?.price?.marketCap?.raw ?? null,
    fiftyTwoWeekLow: r?.summaryDetail?.fiftyTwoWeekLow?.raw ?? null,
    fiftyTwoWeekHigh: r?.summaryDetail?.fiftyTwoWeekHigh?.raw ?? null,
    dividendYieldForward: r?.summaryDetail?.dividendYield?.raw ?? null,
  };
  cache.set(ticker, { datos, ts: Date.now() });
  return datos;
}

/**
 * Mapa ticker → fundamentals (P/E, market cap, rango 52 semanas, variación 1D).
 * Tickers sin dato (delisted, sin crumb disponible, símbolo no reconocido) se
 * omiten del mapa en vez de romper la respuesta completa.
 */
export async function fetchFundamentals(tickers: string[]): Promise<Record<string, Fundamentals>> {
  const out: Record<string, Fundamentals> = {};
  if (tickers.length === 0) return out;
  const cred = await getCrumb();
  if (!cred) return out;

  const settled = await Promise.allSettled(
    tickers.map(async (t) => [t.toUpperCase(), await fetchFundamentalsTicker(t, cred)] as const),
  );
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value[1] != null) out[r.value[0]] = r.value[1];
  }
  return out;
}
