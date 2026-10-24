import { MAPEO_BONOS_ARG } from './bonosArg';
import { aliasYahoo } from './tickersElegibles';

// Precios de mercado para estimar cuántas unidades/nominales tenés a partir del
// valor de tu posición (el Sheet guarda valor en USD, no cantidad).
//
// Decisión sobre el dólar MEP (uno por fecha, no un MEP único):
// docs/decisiones/0007-mep-mensual-no-mep-unico.md

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36';

// ── Acciones/ETF USA: precio por acción (Yahoo chart) ───────────────────────

/** Precio spot + dividend yield trailing 12 meses, derivados de la misma llamada. */
export interface DatosAccion {
  px: number;
  /** Dividendos por acción sumados en los últimos 12 meses (USD). 0 si no paga. */
  divAnual: number;
  /** divAnual / px, en tanto por uno (0.0093 = 0.93%). */
  yieldAnual: number;
  /** Cantidad de pagos en los últimos 12 meses; permite inferir la frecuencia. */
  pagos: number;
  /** Variaciones en tanto por uno, derivadas de la misma serie de closes diarios (1 año). null si no hay suficiente historia. */
  variacion1m: number | null;
  variacionYtd: number | null;
  variacion1a: number | null;
}

const cachePrecioAccion = new Map<string, { datos: DatosAccion; ts: number }>();
const CACHE_MS = 60 * 60 * 1000; // 1 hora

/** Variación entre el último close y el close en o antes de `objetivoTs` (segundos epoch); null si no hay dato suficientemente viejo. */
function variacionDesde(
  closes: { ts: number; close: number }[],
  ultimoClose: number,
  objetivoTs: number,
): number | null {
  let candidato: number | null = null;
  for (const c of closes) {
    if (c.ts <= objetivoTs) candidato = c.close;
    else break;
  }
  if (candidato == null || candidato <= 0) return null;
  return ultimoClose / candidato - 1;
}

// El yield y las variaciones se derivan del historial diario del chart en vez
// de pedir quoteSummary por separado: ese endpoint devuelve 401 sin
// cookie+crumb (ver lib/yahooFundamentals.ts para el que sí usa crumb), y acá
// una sola llamada de 1 año a interval diario alcanza para precio, dividendos
// y las tres variaciones (1M/YTD/1A) sin requests extra.
async function fetchDatosAccion(ticker: string): Promise<DatosAccion | null> {
  const hit = cachePrecioAccion.get(ticker);
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit.datos;
  try {
    // aliasYahoo: el ticker del Sheet no siempre es el símbolo del proveedor
    // (las acciones con clase usan guión: BRKB → BRK-B). Sin esto el chart
    // devuelve 404 y la posición se cae del tab de renta variable.
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(aliasYahoo(ticker))}?range=1y&interval=1d&events=div`;
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const px: number | undefined = result?.meta?.regularMarketPrice;
    if (typeof px !== 'number' || px <= 0) return null;

    const dividends: Record<string, { amount: number; date: number }> = result?.events?.dividends ?? {};
    const desde = Date.now() / 1000 - 365 * 86_400;
    const ultimos = Object.values(dividends).filter((d) => d.date >= desde);
    const divAnual = ultimos.reduce((s, d) => s + d.amount, 0);

    const timestamps: number[] = result?.timestamp ?? [];
    const closesRaw: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
    const closes = timestamps
      .map((ts, i) => ({ ts, close: closesRaw[i] }))
      .filter((c): c is { ts: number; close: number } => typeof c.close === 'number' && c.close > 0);

    const ahora = Date.now() / 1000;
    const inicioAnioActual = Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000;
    const variacion1m = variacionDesde(closes, px, ahora - 30 * 86_400);
    const variacionYtd = variacionDesde(closes, px, inicioAnioActual);
    const variacion1a = closes.length > 0 ? px / closes[0].close - 1 : null;

    const datos: DatosAccion = {
      px, divAnual, yieldAnual: divAnual / px, pagos: ultimos.length,
      variacion1m, variacionYtd, variacion1a,
    };
    cachePrecioAccion.set(ticker, { datos, ts: Date.now() });
    return datos;
  } catch {
    return null;
  }
}

/** Mapa ticker USA → precio por acción (USD). */
export async function preciosAcciones(tickers: string[]): Promise<Record<string, number>> {
  const datos = await datosAcciones(tickers);
  const out: Record<string, number> = {};
  for (const [t, d] of Object.entries(datos)) out[t] = d.px;
  return out;
}

/** Mapa ticker USA → precio, dividendo anual y yield trailing 12m. */
export async function datosAcciones(tickers: string[]): Promise<Record<string, DatosAccion>> {
  const out: Record<string, DatosAccion> = {};
  const results = await Promise.all(
    tickers.map(async (t) => [t.toUpperCase(), await fetchDatosAccion(t)] as const),
  );
  for (const [t, d] of results) if (d != null) out[t] = d;
  return out;
}

// ── Bonos/ONs ARG: precio en USD por 100 nominales (data912, especie "D") ────

let cacheBonos: { precios: Record<string, number>; ts: number } | null = null;

async function fetchTodosPreciosBonos(): Promise<Record<string, number>> {
  if (cacheBonos && Date.now() - cacheBonos.ts < CACHE_MS) return cacheBonos.precios;

  const endpoints = ['arg_bonds', 'arg_corp', 'arg_notes'];
  const precios: Record<string, number> = {};

  await Promise.all(
    endpoints.map(async (ep) => {
      try {
        const res = await fetch(`https://data912.com/live/${ep}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
        if (!res.ok) return;
        const rows: { symbol: string; px_bid: number; px_ask: number; c: number }[] = await res.json();
        for (const r of rows) {
          // Preferir el precio de cierre; si no, el mid de bid/ask.
          const px = r.c > 0 ? r.c : (r.px_bid > 0 && r.px_ask > 0 ? (r.px_bid + r.px_ask) / 2 : 0);
          if (px > 0) precios[r.symbol] = px;
        }
      } catch { /* endpoint puntual falla, seguimos con los demás */ }
    }),
  );

  cacheBonos = { precios, ts: Date.now() };
  return precios;
}

/**
 * Mapa ticker-cartera (ej. "AL30") → precio USD por 100 nominales, usando la
 * especie "D"/cable de data912 (que cotiza en USD igual que el valor del Sheet).
 */
export async function preciosBonos(tickers: string[]): Promise<Record<string, number>> {
  const todos = await fetchTodosPreciosBonos();
  const out: Record<string, number> = {};
  for (const t of tickers) {
    const key = t.toUpperCase();
    const simboloD = MAPEO_BONOS_ARG[key];
    if (!simboloD) continue;
    // Preferimos la especie "D" (USD). Si no cotiza, probamos el símbolo tal cual.
    const px = todos[simboloD] ?? todos[key];
    if (px != null && px > 0) out[key] = px;
  }
  return out;
}

/**
 * Mapa ticker-cartera → precio ARS por 100 nominales, usando el símbolo base
 * (no la especie "D"/cable). Bonos que solo pagan en pesos (CER, duales,
 * dollar-linked, Lecap/Boncap) no siempre tienen especie "D", así que este
 * precio es el que corresponde para calcular nominales cuando el pago es en ARS.
 */
export async function preciosBonosArs(tickers: string[]): Promise<Record<string, number>> {
  const todos = await fetchTodosPreciosBonos();
  const out: Record<string, number> = {};
  for (const t of tickers) {
    const key = t.toUpperCase();
    if (!MAPEO_BONOS_ARG[key]) continue;
    const px = todos[key];
    if (px != null && px > 0) out[key] = px;
  }
  return out;
}

/**
 * Precio ARS por 100 nominales de símbolos que NO están en MAPEO_BONOS_ARG
 * (provinciales, Bonos de Consolidación): se piden por símbolo exacto de
 * data912, sin pasar por el mapeo de tickers de cartera. Lo usa
 * bonosProvinciales.ts, que calcula TIR/duration a partir de este precio.
 */
export async function preciosBonosPorSimbolo(simbolos: string[]): Promise<Record<string, number>> {
  const todos = await fetchTodosPreciosBonos();
  const out: Record<string, number> = {};
  for (const s of simbolos) {
    const px = todos[s.toUpperCase()];
    if (px != null && px > 0) out[s.toUpperCase()] = px;
  }
  return out;
}

// ── Dólar MEP spot ───────────────────────────────────────────────────────────

let cacheMep: { valor: number; ts: number } | null = null;

/** Dólar MEP actual (pesos por dólar), para convertir tenencias USD del Sheet a ARS. */
export async function mepSpot(): Promise<number | null> {
  if (cacheMep && Date.now() - cacheMep.ts < CACHE_MS) return cacheMep.valor;
  try {
    const res = await fetch('https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa', {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json: { fecha: string; venta: number }[] = await res.json();
    if (json.length === 0) return null;
    const ultimo = json.reduce((a, b) => (b.fecha > a.fecha ? b : a));
    cacheMep = { valor: ultimo.venta, ts: Date.now() };
    return ultimo.venta;
  } catch {
    return null;
  }
}
