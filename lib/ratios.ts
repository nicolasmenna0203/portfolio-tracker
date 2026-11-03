// Decisión y alternativas descartadas: docs/decisiones/0018-ratios-alineados-por-fecha-e-indicadores-en-el-cliente.md
//
// ── Ratios entre dos activos ────────────────────────────────────────────────
//
// La serie de un par A/B: el precio de A dividido por el de B, fecha a fecha.
// Sirve para leer fuerza relativa —"¿A le viene ganando a B?"— sin que el
// movimiento general del mercado contamine la lectura: si ambos suben 20%, el
// ratio queda plano, que es exactamente la información que se busca.
//
// ── Por qué la serie se alinea por fecha y no por índice ─────────────────────
//
// Las dos series vienen de llamadas separadas a Yahoo y NO tienen por qué
// traer los mismos días: feriados distintos (un CEDEAR sigue el calendario de
// NYSE, BTC cotiza los fines de semana), suspensiones, o simplemente un ticker
// con menos historia que el otro. Alinear por posición en el array —puntos[i]
// contra puntos[i]— aparea silenciosamente el martes de uno con el miércoles
// del otro y desplaza toda la serie a partir de ahí. Por eso se indexa por
// fecha y solo sobreviven las fechas presentes en ambas.
//
// ── Por qué todo esto es puro y no toca la red ──────────────────────────────
//
// Este módulo recibe los puntos ya bajados y solo hace aritmética. El fetch
// vive en la API route, que reusa `fetchHistoricoTicker` (con su cache de 1h)
// una vez por ticker. Así los indicadores son testeables con series armadas a
// mano, sin fixtures de red.

import type { PrecioHistoricoPunto } from '@/types';

/** Un punto de la serie del ratio, con los precios que lo originaron. */
export interface PuntoRatio {
  fecha: string; // "YYYY-MM-DD"
  /** Precio de A / precio de B. */
  ratio: number;
  pxA: number;
  pxB: number;
}

/**
 * Serie del ratio A/B alineada por fecha.
 *
 * Se descartan las fechas que no están en ambas series y los precios <= 0 (un
 * cero dividendo daría Infinity y rompería toda métrica aguas abajo). El
 * resultado queda ordenado por fecha ascendente, que es lo que asumen los
 * indicadores de más abajo.
 */
export function serieRatio(
  puntosA: PrecioHistoricoPunto[],
  puntosB: PrecioHistoricoPunto[],
): PuntoRatio[] {
  const porFechaB = new Map<string, number>();
  for (const p of puntosB) {
    if (p.close > 0) porFechaB.set(p.fecha, p.close);
  }

  const out: PuntoRatio[] = [];
  for (const a of puntosA) {
    if (a.close <= 0) continue;
    const pxB = porFechaB.get(a.fecha);
    if (pxB == null) continue;
    out.push({ fecha: a.fecha, ratio: a.close / pxB, pxA: a.close, pxB });
  }

  out.sort((x, y) => x.fecha.localeCompare(y.fecha));
  return out;
}

// ── Medias móviles ───────────────────────────────────────────────────────────

/**
 * Media móvil simple. Los primeros `periodo - 1` puntos son `null` en vez de
 * un promedio parcial: promediar 3 valores en una SMA de 20 daría una línea
 * que arranca pegada al precio y converge, un artefacto que se lee como señal.
 */
export function sma(valores: number[], periodo: number): (number | null)[] {
  if (periodo <= 0) return valores.map(() => null);

  const out: (number | null)[] = [];
  let suma = 0;
  for (let i = 0; i < valores.length; i++) {
    suma += valores[i];
    if (i >= periodo) suma -= valores[i - periodo];
    out.push(i >= periodo - 1 ? suma / periodo : null);
  }
  return out;
}

/**
 * Media móvil exponencial, sembrada con la SMA del primer bloque completo.
 *
 * Sembrar con la SMA en vez de arrancar la recursión en el primer valor es la
 * convención de las plataformas de trading: arrancar en valores[0] hace que la
 * EMA temprana quede anclada a un único dato y tarde varios períodos en
 * despegarse, y ese tramo inicial no es comparable con el de otra herramienta.
 */
export function ema(valores: number[], periodo: number): (number | null)[] {
  const out: (number | null)[] = valores.map(() => null);
  if (periodo <= 0 || valores.length < periodo) return out;

  const k = 2 / (periodo + 1);
  let previa = valores.slice(0, periodo).reduce((s, v) => s + v, 0) / periodo;
  out[periodo - 1] = previa;

  for (let i = periodo; i < valores.length; i++) {
    previa = valores[i] * k + previa * (1 - k);
    out[i] = previa;
  }
  return out;
}

// ── Bandas de Bollinger ──────────────────────────────────────────────────────

export interface Bollinger {
  media: (number | null)[];
  superior: (number | null)[];
  inferior: (number | null)[];
}

/**
 * Bandas de Bollinger: SMA ± `desvios` desvíos estándar.
 *
 * Se usa el desvío **poblacional** (dividir por n, no por n-1). Es lo que hace
 * la formulación original de Bollinger y lo que replican las plataformas; con
 * n-1 las bandas quedan apenas más anchas y los toques de banda no coinciden
 * con los que ve cualquier otra herramienta sobre el mismo par.
 */
export function bollinger(valores: number[], periodo: number, desvios = 2): Bollinger {
  const media = sma(valores, periodo);
  const superior: (number | null)[] = [];
  const inferior: (number | null)[] = [];

  for (let i = 0; i < valores.length; i++) {
    const m = media[i];
    if (m == null) {
      superior.push(null);
      inferior.push(null);
      continue;
    }
    const ventana = valores.slice(i - periodo + 1, i + 1);
    const varianza = ventana.reduce((s, v) => s + (v - m) ** 2, 0) / periodo;
    const sd = Math.sqrt(varianza);
    superior.push(m + desvios * sd);
    inferior.push(m - desvios * sd);
  }

  return { media, superior, inferior };
}

// ── Retornos, correlación y beta ─────────────────────────────────────────────

/**
 * Retornos simples punto a punto. La serie resultante tiene un elemento menos
 * que la de precios: el primer punto no tiene contra qué compararse.
 *
 * Se usan retornos simples y no logarítmicos porque correlación y beta acá se
 * leen como "cuánto se mueve A cuando B se mueve 1%", y esa lectura es directa
 * sobre el retorno simple.
 */
export function retornos(valores: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < valores.length; i++) {
    const previo = valores[i - 1];
    out.push(previo > 0 ? valores[i] / previo - 1 : 0);
  }
  return out;
}

/**
 * Correlación de Pearson entre dos series de retornos de igual largo.
 *
 * Devuelve `null` si alguna de las dos no tiene varianza (una serie constante
 * no tiene correlación definida — el denominador es cero) o si hay menos de
 * dos puntos. Un `null` acá se muestra como "s/d", nunca como 0: 0 significa
 * "se mueven de forma independiente", que es una afirmación muy distinta.
 */
export function correlacion(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;

  const mediaA = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mediaB = b.slice(0, n).reduce((s, v) => s + v, 0) / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const dA = a[i] - mediaA;
    const dB = b[i] - mediaB;
    cov += dA * dB;
    varA += dA * dA;
    varB += dB * dB;
  }

  if (varA === 0 || varB === 0) return null;
  return cov / Math.sqrt(varA * varB);
}

/**
 * Beta de A contra B: cov(A,B) / var(B). Cuánto se mueve A, en promedio, por
 * cada 1% que se mueve B.
 *
 * `null` si B no tiene varianza: sin movimiento en el activo de referencia no
 * hay pendiente que estimar.
 */
export function beta(retornosA: number[], retornosB: number[]): number | null {
  const n = Math.min(retornosA.length, retornosB.length);
  if (n < 2) return null;

  const mediaA = retornosA.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mediaB = retornosB.slice(0, n).reduce((s, v) => s + v, 0) / n;

  let cov = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (retornosA[i] - mediaA) * (retornosB[i] - mediaB);
    varB += (retornosB[i] - mediaB) ** 2;
  }

  if (varB === 0) return null;
  return cov / varB;
}

/**
 * Correlación móvil sobre una ventana de `periodo` retornos. Las primeras
 * posiciones son `null` hasta que hay ventana completa.
 *
 * Es más informativa que la correlación única del período: dos activos pueden
 * dar 0.6 en el agregado y haber pasado de 0.9 a -0.2 en el medio, que es
 * justo cuando el par deja de comportarse como par.
 */
export function correlacionMovil(a: number[], b: number[], periodo: number): (number | null)[] {
  const n = Math.min(a.length, b.length);
  const out: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    if (i < periodo - 1) {
      out.push(null);
      continue;
    }
    out.push(correlacion(a.slice(i - periodo + 1, i + 1), b.slice(i - periodo + 1, i + 1)));
  }
  return out;
}

// ── Resumen estadístico del par ──────────────────────────────────────────────

export interface EstadisticasRatio {
  /** Último valor del ratio. */
  actual: number;
  minimo: number;
  maximo: number;
  promedio: number;
  /**
   * Posición del ratio actual dentro del rango del período, 0-100. 0 = está en
   * el mínimo histórico del rango, 100 = en el máximo. `null` si el rango es
   * degenerado (mín == máx), donde el percentil no significaría nada.
   */
  percentil: number | null;
  /** Variación del ratio entre el primer y el último punto, en tanto por uno. */
  variacion: number;
  /** Desvíos estándar del ratio actual respecto del promedio del período. */
  zScore: number | null;
  correlacion: number | null;
  beta: number | null;
}

/** Métricas del par sobre el rango completo de la serie. */
export function estadisticas(serie: PuntoRatio[]): EstadisticasRatio | null {
  if (serie.length === 0) return null;

  const valores = serie.map((p) => p.ratio);
  const actual = valores[valores.length - 1];
  const minimo = Math.min(...valores);
  const maximo = Math.max(...valores);
  const promedio = valores.reduce((s, v) => s + v, 0) / valores.length;

  const sd = Math.sqrt(valores.reduce((s, v) => s + (v - promedio) ** 2, 0) / valores.length);

  const retA = retornos(serie.map((p) => p.pxA));
  const retB = retornos(serie.map((p) => p.pxB));

  return {
    actual,
    minimo,
    maximo,
    promedio,
    percentil: maximo > minimo ? ((actual - minimo) / (maximo - minimo)) * 100 : null,
    variacion: valores[0] > 0 ? actual / valores[0] - 1 : 0,
    zScore: sd > 0 ? (actual - promedio) / sd : null,
    correlacion: correlacion(retA, retB),
    beta: beta(retA, retB),
  };
}
