import type { SectorHolding, SectorHoldingsInfo } from '@/types';
import { getCrumb, UA } from './yahooCrumb';

// Por qué quoteSummary necesita cookie+crumb:
// docs/decisiones/0008-yahoo-cookie-crumb-y-yield-desde-chart.md
//
// Composición (top holdings) de los ETFs sectoriales de SectoresMercado.tsx,
// vía los módulos topHoldings + fundProfile de quoteSummary — mismo mecanismo
// cookie+crumb que ya usan lib/yahooFundamentals.ts y lib/yahooEarnings.ts.
// Validado en vivo: topHoldings.holdings trae el top 10 con symbol/nombre/peso;
// fundProfile trae gestora y expense ratio.

interface QuoteSummaryHoldingsRaw {
  topHoldings?: {
    holdings?: { symbol?: string; holdingName?: string; holdingPercent?: { raw?: number } }[];
  };
  fundProfile?: {
    family?: string;
    feesExpensesInvestment?: { annualReportExpenseRatio?: { raw?: number } };
  };
}

const CACHE_MS = 24 * 60 * 60 * 1000; // 24h: la composición de un ETF sectorial cambia muy poco día a día
const cache = new Map<string, { datos: SectorHoldingsInfo; ts: number }>();

/** Composición (top 10 holdings, gestora, expense ratio) de un ETF sectorial. */
export async function fetchSectorHoldings(ticker: string): Promise<SectorHoldingsInfo | null> {
  const key = ticker.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit.datos;

  const cred = await getCrumb();
  if (!cred) return null;

  const modules = 'topHoldings,fundProfile';
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(key)}?modules=${modules}&crumb=${encodeURIComponent(cred.crumb)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Cookie: cred.cookie },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const r: QuoteSummaryHoldingsRaw | undefined = json?.quoteSummary?.result?.[0];
  if (!r) return null;

  const holdings: SectorHolding[] = (r.topHoldings?.holdings ?? [])
    .filter((h): h is { symbol: string; holdingName: string; holdingPercent: { raw: number } } =>
      typeof h.symbol === 'string' && typeof h.holdingPercent?.raw === 'number')
    .map((h) => ({ symbol: h.symbol, nombre: h.holdingName ?? h.symbol, peso: h.holdingPercent.raw }));

  const datos: SectorHoldingsInfo = {
    ticker: key,
    gestora: r.fundProfile?.family ?? null,
    expenseRatio: r.fundProfile?.feesExpensesInvestment?.annualReportExpenseRatio?.raw ?? null,
    holdings,
  };
  cache.set(key, { datos, ts: Date.now() });
  return datos;
}
