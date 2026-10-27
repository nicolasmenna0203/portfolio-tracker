// Series de benchmarks (S&P 500, oro, MEP, inflación, BTC) rebasadas a índice 100.
//
// Este módulo solo trae los benchmarks externos. La serie de la cartera que
// se compara contra estas vive en components/BenchmarksTab.tsx y en
// lib/agentTools.ts (compararBenchmarks): es TWR (lib/twr.ts), no el total
// crudo — ver docs/decisiones/0022-twr-modified-dietz-encadenado.md.
// El MEP histórico sale de acá (fetchMepPorFecha), con fallback al día hábil
// anterior: docs/decisiones/0007-mep-mensual-no-mep-unico.md

import { toMesKey } from './parser';
import type { BenchmarkId, BenchmarkPoint, BenchmarkSeries } from '@/types';

interface RawMonthlyPrice {
  mesKey: string; // "YYYY-MM"
  valor: number;  // precio/índice crudo, aún no rebasado a 100
}

// ── Fuente 1 y 2: Yahoo Finance chart API (S&P500, Oro) ────────────────────────

async function fetchYahooMensual(ticker: string, desdeTs: number): Promise<RawMonthlyPrice[]> {
  const period1 = Math.floor(desdeTs / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1mo`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Yahoo Finance (${ticker}): HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo Finance (${ticker}): sin datos`);

  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

  const out: RawMonthlyPrice[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null) continue;
    out.push({ mesKey: toMesKey(timestamps[i] * 1000), valor: closes[i]! });
  }
  return out;
}

// ── Fuente 4: ArgentinaDatos — Dólar MEP ────────────────────────────────────────

async function fetchMepMensual(desdeTs: number): Promise<RawMonthlyPrice[]> {
  const res = await fetch('https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa');
  if (!res.ok) throw new Error(`ArgentinaDatos (MEP): HTTP ${res.status}`);
  const json: { fecha: string; venta: number }[] = await res.json();

  const desdeMesKey = toMesKey(desdeTs);
  const porMes = new Map<string, { fecha: string; venta: number }>();
  for (const r of json) {
    const mesKey = r.fecha.slice(0, 7);
    if (mesKey < desdeMesKey) continue;
    const prev = porMes.get(mesKey);
    if (!prev || r.fecha > prev.fecha) porMes.set(mesKey, r);
  }
  if (porMes.size === 0) throw new Error('ArgentinaDatos (MEP): sin datos en el rango');

  return [...porMes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mesKey, r]) => ({ mesKey, valor: r.venta }));
}

// Expone el dólar MEP en su valor absoluto (pesos por dólar), sin pasar por
// rebase100 — usado para convertir montos nominales (aportes) a ARS, a diferencia
// de fetchBenchmarks() que siempre indexa a base 100 para el gráfico comparativo.
export async function fetchMepAbsoluto(desdeTs: number): Promise<{ mesKey: string; valorArs: number }[]> {
  const puntos = await fetchMepMensual(desdeTs);
  return puntos.map((p) => ({ mesKey: p.mesKey, valorArs: p.valor }));
}

/**
 * Dólar MEP diario (valor absoluto) para un conjunto de fechas puntuales
 * "YYYY-MM-DD" — usado para convertir haberes a USD con la cotización del
 * día exacto de cada acreditación, no un promedio mensual. Si un día no tiene
 * cotización propia (fin de semana/feriado), usa el hábil más cercano hacia atrás.
 */
export async function fetchMepPorFecha(fechas: string[]): Promise<Record<string, number>> {
  if (fechas.length === 0) return {};
  const res = await fetch('https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa');
  if (!res.ok) throw new Error(`ArgentinaDatos (MEP): HTTP ${res.status}`);
  const json: { fecha: string; venta: number }[] = await res.json();

  const porFecha = new Map<string, number>();
  for (const r of json) porFecha.set(r.fecha, r.venta);
  const fechasOrdenadas = [...porFecha.keys()].sort();

  const out: Record<string, number> = {};
  for (const f of fechas) {
    if (porFecha.has(f)) { out[f] = porFecha.get(f)!; continue; }
    // Fallback: última cotización disponible antes de esta fecha.
    let anterior: string | undefined;
    for (const disponible of fechasOrdenadas) {
      if (disponible > f) break;
      anterior = disponible;
    }
    if (anterior) out[f] = porFecha.get(anterior)!;
  }
  return out;
}

// ── Fuente 5: ArgentinaDatos — Inflación IPC INDEC ──────────────────────────────

async function fetchInflacionMensual(desdeTs: number): Promise<RawMonthlyPrice[]> {
  const res = await fetch('https://api.argentinadatos.com/v1/finanzas/indices/inflacion');
  if (!res.ok) throw new Error(`ArgentinaDatos (Inflación): HTTP ${res.status}`);
  const json: { fecha: string; valor: number }[] = await res.json();

  const desdeMesKey = toMesKey(desdeTs);
  const filtrado = json
    .filter((r) => r.fecha.slice(0, 7) >= desdeMesKey)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (filtrado.length === 0) throw new Error('ArgentinaDatos (Inflación): sin datos en el rango');

  let indice = 100;
  return filtrado.map((r) => {
    indice = indice * (1 + r.valor / 100);
    return { mesKey: r.fecha.slice(0, 7), valor: indice };
  });
}

// ── Rebase a índice base 100 ─────────────────────────────────────────────────

function rebase100(raw: RawMonthlyPrice[], mesesCartera: string[]): BenchmarkPoint[] {
  if (raw.length === 0) return [];
  const porMes = new Map(raw.map((r) => [r.mesKey, r.valor]));
  const primerValor = raw[0].valor;

  const puntos: BenchmarkPoint[] = [];
  let ultimoConocido: number | null = null;
  for (const mesKey of mesesCartera) {
    if (mesKey < raw[0].mesKey) continue;
    const v = porMes.get(mesKey);
    if (v != null) ultimoConocido = v;
    if (ultimoConocido == null) continue;
    puntos.push({ mesKey, fecha: mesKeyToLabel(mesKey), valor: (ultimoConocido / primerValor) * 100 });
  }
  return puntos;
}

function mesKeyToLabel(mesKey: string): string {
  const [y, m] = mesKey.split('-').map(Number);
  const ts = Date.UTC(y, m - 1, 1);
  const d = new Date(ts);
  const mes = d.toLocaleString('es-AR', { month: 'short', timeZone: 'UTC' });
  return `${mes}-${String(y).slice(2)}`;
}

export function mesKeyToTs(mesKey: string): number {
  const [y, m] = mesKey.split('-').map(Number);
  return Date.UTC(y, m - 1, 1);
}

// ── Orquestador ──────────────────────────────────────────────────────────────

const FUENTES: { id: BenchmarkId; label: string; fetch: (desdeTs: number) => Promise<RawMonthlyPrice[]> }[] = [
  { id: 'sp500', label: 'S&P 500', fetch: (t) => fetchYahooMensual('^GSPC', t) },
  { id: 'oro', label: 'Oro', fetch: (t) => fetchYahooMensual('GC=F', t) },
  { id: 'btc', label: 'Bitcoin', fetch: (t) => fetchYahooMensual('BTC-USD', t) },
  { id: 'mep', label: 'Dólar MEP', fetch: fetchMepMensual },
  { id: 'inflacion', label: 'Inflación (IPC INDEC)', fetch: fetchInflacionMensual },
];

export async function fetchBenchmarks(mesesCartera: string[]): Promise<BenchmarkSeries[]> {
  if (mesesCartera.length === 0) return [];
  const desdeTs = mesKeyToTs(mesesCartera[0]);

  const settled = await Promise.allSettled(FUENTES.map((f) => f.fetch(desdeTs)));

  return FUENTES.map((f, i) => {
    const r = settled[i];
    if (r.status === 'rejected') {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      return { id: f.id, label: f.label, puntos: [], error: msg };
    }
    return { id: f.id, label: f.label, puntos: rebase100(r.value, mesesCartera) };
  });
}
