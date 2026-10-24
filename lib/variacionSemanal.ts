// Decisión y alternativas descartadas: docs/decisiones/0003-variacion-semanal-por-moneda-nativa.md
//
// Variación de precio de los últimos 7 días de cada posición de la cartera,
// en USD y en ARS, agrupada por tipo de activo — el insumo del bloque de
// mercado del mail semanal.
//
// La variación en pesos NO es la variación en dólares corrida por el MEP: un
// CEDEAR plano en USD sube en pesos si el MEP subió, y un bono en pesos plano
// en ARS cae en USD. Por eso cada pata se calcula sobre la serie en su moneda
// nativa y la otra se deriva convirtiendo AMBOS extremos con el MEP de su
// propia fecha, no con el MEP de hoy en los dos.

import type { TenenciaActual } from '@/types';
import { MAPEO_BONOS_ARG } from './bonosArg';
import { fetchFciMetrics, type FciMetric } from './fciCocos';
import { TIPOS_VALIDOS, TICKERS_EXCLUIR, TICKERS_INCLUIR, aliasYahoo } from './tickersElegibles';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36';
const DIAS = 7;

export interface VariacionActivo {
  ticker: string;
  /** Etiqueta de tipo ya normalizada (ACCIONES, ETF, BONOS, FCI, ...). */
  tipo: string;
  tenenciaUsd: number;
  /** Precio de cierre de hoy y de hace ~7 días, en la moneda nativa del activo. */
  precioUsd: number | null;
  precioUsdPrevio: number | null;
  precioArs: number | null;
  precioArsPrevio: number | null;
  /** Variaciones en tanto por uno (0.0123 = +1.23%); null si falta alguna punta. */
  variacionUsd: number | null;
  variacionArs: number | null;
  /** Motivo por el que no hay dato, para mostrarlo en vez de un 0 engañoso. */
  nota?: string;
}

export interface VariacionGrupo {
  tipo: string;
  activos: VariacionActivo[];
  /** Promedio simple de las variaciones disponibles del grupo. */
  promedioUsd: number | null;
  promedioArs: number | null;
  tenenciaUsd: number;
}

export interface VariacionSemanal {
  desde: string; // YYYY-MM-DD
  hasta: string; // YYYY-MM-DD
  grupos: VariacionGrupo[];
  mepActual: number | null;
  mepPrevio: number | null;
  /** Variación del dólar MEP en el mismo período, tanto por uno. */
  variacionMep: number | null;
  errores: string[];
}

function fmtFecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Cierre más reciente con fecha <= objetivo. null si la serie empieza después. */
function cierreEnOAntes<T extends { fecha: string }>(serie: T[], objetivo: string): T | null {
  let out: T | null = null;
  for (const p of serie) {
    if (p.fecha <= objetivo) out = p;
    else break;
  }
  return out;
}

function variacion(actual: number | null, previo: number | null): number | null {
  if (actual == null || previo == null || previo <= 0) return null;
  return actual / previo - 1;
}

/**
 * Máximo desvío tolerado entre el MEP implícito (precio ARS / precio USD de un
 * mismo bono) y el MEP de mercado de esa fecha.
 *
 * Sirve de control de calidad sobre data912: la rueda del día todavía se está
 * formando y las especies "D"/cable son ilíquidas, así que a veces el último
 * precio USD es un trade viejo o de punta muy ancha. Cuando eso pasa el par
 * ARS/USD deja de cruzar contra el MEP real y la variación en dólares sale
 * disparada (visto en GD30: −2,5% en USD contra +1,3% en ARS con el MEP casi
 * plano).
 *
 * El umbral sale de medir el desvío real del cruce de GD30 contra el MEP de
 * bolsa: en ruedas sanas se mantiene dentro de ±0,7%, y el día del precio roto
 * saltó a +3,7%. 2,5% deja holgura de sobra para la brecha legítima entre el
 * MEP de bolsa y el implícito de un bono puntual, y aun así corta el caso malo.
 */
const TOLERANCIA_CRUCE = 0.025;

/** ¿El par (ARS, USD) cruza contra el MEP de referencia dentro de la tolerancia? */
function cruceCoherente(ars: number | null, usd: number | null, mep: number | null): boolean {
  if (ars == null || usd == null || mep == null || usd <= 0 || mep <= 0) return true; // sin con qué comparar
  const mepImplicito = ars / usd;
  return Math.abs(mepImplicito / mep - 1) <= TOLERANCIA_CRUCE;
}

// ── Serie de MEP diaria (argentinadatos) ────────────────────────────────────

interface PuntoMep { fecha: string; valor: number }

async function serieMep(): Promise<PuntoMep[]> {
  const res = await fetch('https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa', {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`MEP: HTTP ${res.status}`);
  const json: { fecha: string; venta: number }[] = await res.json();
  return json
    .filter((d) => typeof d.venta === 'number' && d.venta > 0)
    .map((d) => ({ fecha: d.fecha, valor: d.venta }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// ── Acciones/ETF/CEDEAR: serie diaria en USD (Yahoo) ────────────────────────

interface PuntoCierre { fecha: string; close: number }

async function serieYahoo(ticker: string): Promise<PuntoCierre[]> {
  // aliasYahoo: el ticker de cartera puede no ser el símbolo del proveedor (BRKB → BRK-B).
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(aliasYahoo(ticker))}?range=1mo&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Yahoo ${ticker}: HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const timestamps: number[] = result?.timestamp ?? [];
  const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
  return timestamps
    .map((ts, i) => ({ ts, close: closes[i] }))
    .filter((p): p is { ts: number; close: number } => typeof p.close === 'number' && p.close > 0)
    .map((p) => ({ fecha: new Date(p.ts * 1000).toISOString().slice(0, 10), close: p.close }));
}

// ── Bonos/ONs ARG: serie diaria de data912 ──────────────────────────────────
//
// data912 expone /historical/bonds/{símbolo}: el símbolo base (ej. "AL30")
// cotiza en ARS y la especie "D" (ej. "AL30D") en USD, así que las dos patas
// salen de la misma fuente sin pasar por el MEP.

async function serieBono(simbolo: string): Promise<PuntoCierre[]> {
  const res = await fetch(`https://data912.com/historical/bonds/${encodeURIComponent(simbolo)}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`data912 ${simbolo}: HTTP ${res.status}`);
  const rows: { date: string; c: number }[] = await res.json();
  return rows
    .filter((r) => typeof r.c === 'number' && r.c > 0)
    .map((r) => ({ fecha: r.date, close: r.c }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Clasifica una tenencia en el tipo que se usa para agrupar en el mail. */
function tipoDe(t: TenenciaActual): string {
  const tipo = (t.TIPO ?? '').toUpperCase().trim();
  return tipo === 'ACCION' ? 'ACCIONES' : (tipo || 'OTRO');
}

function esAccionUsa(t: TenenciaActual): boolean {
  const ticker = t.ticker.toUpperCase();
  if (TICKERS_EXCLUIR.has(ticker)) return false;
  if (TICKERS_INCLUIR.has(ticker)) return true;
  return TIPOS_VALIDOS.has((t.TIPO ?? '').toUpperCase()) && t.SECTOR_GEO !== 'ARG';
}

/**
 * Calcula la variación de 7 días de cada posición del último mes de la cartera.
 *
 * Cada fuente se resuelve en paralelo y falla de forma aislada: un ticker sin
 * dato queda con variación null y una nota, en vez de tumbar el mail entero.
 */
export async function calcularVariacionSemanal(
  items: TenenciaActual[],
  dias = DIAS,
): Promise<VariacionSemanal> {
  const errores: string[] = [];
  const hoy = new Date();
  const hasta = fmtFecha(hoy);
  const desdeDate = new Date(hoy);
  desdeDate.setUTCDate(desdeDate.getUTCDate() - dias);
  const desde = fmtFecha(desdeDate);

  // MEP en las dos puntas: sirve para el dato propio y para cruzar monedas.
  let mepSerie: PuntoMep[] = [];
  try {
    mepSerie = await serieMep();
  } catch (e) {
    errores.push(e instanceof Error ? e.message : String(e));
  }
  const mepActual = mepSerie.length > 0 ? mepSerie[mepSerie.length - 1].valor : null;
  const mepPrevio = cierreEnOAntes(mepSerie, desde)?.valor ?? null;
  const variacionMep = variacion(mepActual, mepPrevio);

  const posiciones = items.filter((t) => t.tenencia_usd > 0);

  let fciMetrics = new Map<string, FciMetric>();
  if (posiciones.some((t) => tipoDe(t) === 'FCI')) {
    try {
      fciMetrics = await fetchFciMetrics();
    } catch (e) {
      errores.push(e instanceof Error ? e.message : String(e));
    }
  }

  const resultados = await Promise.all(
    posiciones.map(async (t): Promise<VariacionActivo> => {
      const ticker = t.ticker.toUpperCase();
      const base = { ticker, tipo: tipoDe(t), tenenciaUsd: t.tenencia_usd };

      // ── Bonos/ONs ARG: dos series nativas (ARS base + USD especie "D") ────
      const simboloD = MAPEO_BONOS_ARG[ticker];
      if (simboloD) {
        const [usdRes, arsRes] = await Promise.allSettled([
          serieBono(simboloD),
          // Si el mapeo ya apunta al símbolo base (bonos en pesos sin especie
          // "D"), no tiene sentido pedir la misma serie dos veces.
          simboloD === ticker ? Promise.resolve([]) : serieBono(ticker),
        ]);
        const serieUsd = usdRes.status === 'fulfilled' ? usdRes.value : [];
        const serieArs = arsRes.status === 'fulfilled' ? arsRes.value : [];

        let precioUsd = serieUsd.length > 0 ? serieUsd[serieUsd.length - 1].close : null;
        let precioUsdPrevio = cierreEnOAntes(serieUsd, desde)?.close ?? null;
        let precioArs = serieArs.length > 0 ? serieArs[serieArs.length - 1].close : null;
        let precioArsPrevio = cierreEnOAntes(serieArs, desde)?.close ?? null;

        const mepEnDesde = cierreEnOAntes(mepSerie, desde)?.valor ?? null;

        // Control de calidad: si el par ARS/USD de una punta no cruza contra el
        // MEP de esa fecha, la especie "D" trae un precio roto (ver
        // TOLERANCIA_CRUCE). Se descarta ese precio USD y se lo reconstruye
        // desde la serie en pesos, que es la líquida.
        let ajustado = false;
        if (!cruceCoherente(precioArs, precioUsd, mepActual)) { precioUsd = null; ajustado = true; }
        if (!cruceCoherente(precioArsPrevio, precioUsdPrevio, mepEnDesde)) { precioUsdPrevio = null; ajustado = true; }

        // Completar la pata faltante convirtiendo cada extremo con el MEP de
        // SU fecha (no el de hoy en ambos), para no contaminar la variación.
        if (precioArs == null && precioUsd != null && mepActual != null) precioArs = precioUsd * mepActual;
        if (precioArsPrevio == null && precioUsdPrevio != null && mepEnDesde != null) precioArsPrevio = precioUsdPrevio * mepEnDesde;
        if (precioUsd == null && precioArs != null && mepActual != null) precioUsd = precioArs / mepActual;
        if (precioUsdPrevio == null && precioArsPrevio != null && mepEnDesde != null) precioUsdPrevio = precioArsPrevio / mepEnDesde;

        const varUsd = variacion(precioUsd, precioUsdPrevio);
        const varArs = variacion(precioArs, precioArsPrevio);
        const nota = varUsd == null && varArs == null
          ? 'sin cotización'
          : ajustado ? 'USD estimado vía MEP' : undefined;
        return {
          ...base,
          precioUsd, precioUsdPrevio, precioArs, precioArsPrevio,
          variacionUsd: varUsd, variacionArs: varArs,
          ...(nota ? { nota } : {}),
        };
      }

      // ── FCI del broker: la planilla CAFCI no publica rendimiento a 7 días ──────
      if (base.tipo === 'FCI') {
        const m = fciMetrics.get(ticker);
        if (!m) return { ...base, precioUsd: null, precioUsdPrevio: null, precioArs: null, precioArsPrevio: null, variacionUsd: null, variacionArs: null, nota: 'sin dato CAFCI' };
        // El VCP está en la moneda del fondo. Solo tenemos variación diaria y
        // mensual, no semanal: se informa el VCP y se marca la variación como
        // no disponible antes que inventar una ventana de 7 días.
        const esArs = (m.moneda ?? '').toUpperCase().startsWith('AR');
        return {
          ...base,
          precioUsd: esArs ? (mepActual ? m.vcp / mepActual : null) : m.vcp,
          precioUsdPrevio: null,
          precioArs: esArs ? m.vcp : (mepActual ? m.vcp * mepActual : null),
          precioArsPrevio: null,
          variacionUsd: null,
          variacionArs: null,
          // La variación diaria puede venir vacía en la planilla (fondo con
          // rezago): ahí se omite en vez de informar 0,00%, que sería falso.
          nota: m.variacionDiaria == null
            ? `sin serie 7d (CAFCI al ${m.fecha}, sin variación publicada)`
            : `sin serie 7d (día ${(m.variacionDiaria * 100).toFixed(2)}%)`,
        };
      }

      // ── Acciones/ETF/CEDEAR: serie en USD de Yahoo, ARS vía MEP por fecha ──
      if (esAccionUsa(t)) {
        try {
          const serie = await serieYahoo(ticker);
          const precioUsd = serie.length > 0 ? serie[serie.length - 1].close : null;
          const previo = cierreEnOAntes(serie, desde);
          const precioUsdPrevio = previo?.close ?? null;
          // El MEP se toma en la fecha del close usado, no en `desde`, para que
          // las dos puntas de la conversión correspondan al mismo día de mercado.
          const mepEnPrevio = previo ? (cierreEnOAntes(mepSerie, previo.fecha)?.valor ?? null) : null;
          const precioArs = precioUsd != null && mepActual != null ? precioUsd * mepActual : null;
          const precioArsPrevio = precioUsdPrevio != null && mepEnPrevio != null ? precioUsdPrevio * mepEnPrevio : null;
          return {
            ...base,
            precioUsd, precioUsdPrevio, precioArs, precioArsPrevio,
            variacionUsd: variacion(precioUsd, precioUsdPrevio),
            variacionArs: variacion(precioArs, precioArsPrevio),
            ...(precioUsd == null ? { nota: 'sin cotización' } : {}),
          };
        } catch {
          return { ...base, precioUsd: null, precioUsdPrevio: null, precioArs: null, precioArsPrevio: null, variacionUsd: null, variacionArs: null, nota: 'sin cotización' };
        }
      }

      return { ...base, precioUsd: null, precioUsdPrevio: null, precioArs: null, precioArsPrevio: null, variacionUsd: null, variacionArs: null, nota: 'sin fuente de precio' };
    }),
  );

  // ── Agrupado por tipo, promedio simple de las variaciones disponibles ──────
  const porTipo = new Map<string, VariacionActivo[]>();
  for (const r of resultados) {
    const lista = porTipo.get(r.tipo) ?? [];
    lista.push(r);
    porTipo.set(r.tipo, lista);
  }

  const promedio = (xs: (number | null)[]): number | null => {
    const v = xs.filter((x): x is number => x != null);
    return v.length === 0 ? null : v.reduce((s, x) => s + x, 0) / v.length;
  };

  const grupos: VariacionGrupo[] = [...porTipo.entries()]
    .map(([tipo, activos]) => {
      activos.sort((a, b) => (b.variacionUsd ?? -Infinity) - (a.variacionUsd ?? -Infinity));
      return {
        tipo,
        activos,
        promedioUsd: promedio(activos.map((a) => a.variacionUsd)),
        promedioArs: promedio(activos.map((a) => a.variacionArs)),
        tenenciaUsd: activos.reduce((s, a) => s + a.tenenciaUsd, 0),
      };
    })
    .sort((a, b) => b.tenenciaUsd - a.tenenciaUsd);

  return { desde, hasta, grupos, mepActual, mepPrevio, variacionMep, errores };
}
