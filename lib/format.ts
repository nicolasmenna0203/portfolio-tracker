/**
 * Formateador único de moneda, porcentaje y número para todo el dashboard.
 *
 * Convención: es-AR (miles con punto, decimales con coma), código de moneda
 * explícito con prefijo siempre visible (nunca "$" solo), espacio no cortable
 * (NBSP) entre código y número. El prefijo de cada moneda es una constante
 * (CURRENCY_PREFIX) para poder cambiarlo en un solo lugar.
 */

export type Moneda = 'USD' | 'ARS';

// Cambiar acá el símbolo/prefijo de cada moneda afecta a todo el dashboard.
export const CURRENCY_PREFIX: Record<Moneda, string> = {
  USD: 'USD',
  ARS: 'ARS',
};

const NBSP = ' ';
const MASK = '••••';

/** "1234" → "1,2 mil" / "1234000" → "1,2 M" para ejes compactos. */
function compactNumber(n: number, display: 'long' | 'short' = 'long'): string {
  return new Intl.NumberFormat('es-AR', {
    notation: 'compact',
    compactDisplay: display,
    maximumFractionDigits: 1,
  }).format(n);
}

interface FormatMoneyOptions {
  currency: Moneda;
  /** 'full': sin decimales (cartera/posición/KPI). 'compact': ejes de gráficos ("USD 26 mil"). 'price': 2 decimales (precios/VCP/cotizaciones). */
  mode?: 'full' | 'compact' | 'price';
  /** Solo con mode 'compact': "26 K" en vez de "26 mil", y sin el código de
   *  moneda. El eje Y en mobile tiene ~45px de ancho y "USD 22,5 mil" se corta;
   *  la moneda ya está en el título del gráfico, así que no se pierde nada. */
  compactShort?: boolean;
  /** Antepone "+"/"-" explícito antes del código de moneda (variaciones). */
  sign?: boolean;
  /** Oculta el valor manteniendo el código de moneda visible (botón "Ocultar valores"). */
  hidden?: boolean;
}

/**
 * Formatea un monto en moneda explícita. Regla de decimales:
 * - mode 'full' (default): sin decimales, salvo que |valor| < 100 → 2 decimales
 *   (para no perder "USD 0,08" como "USD 0").
 * - mode 'price': siempre 2 decimales (precios, VCP, cotizaciones).
 * - mode 'compact': notación compacta para ejes de gráficos ("USD 26 mil"), o
 *   "26 K" sin código de moneda con `compactShort` (ejes angostos en mobile).
 */
export function formatMoney(value: number | null | undefined, options: FormatMoneyOptions): string {
  const { currency, mode = 'full', sign = false, hidden = false, compactShort = false } = options;
  const prefix = CURRENCY_PREFIX[currency];

  if (hidden) return `${prefix}${NBSP}${MASK}`;
  if (value == null || Number.isNaN(value)) return `${prefix}${NBSP}s/d`;

  const signo = sign ? (value >= 0 ? '+' : '-') : '';
  const abs = Math.abs(value);

  let numStr: string;
  if (mode === 'compact') {
    numStr = compactNumber(abs, compactShort ? 'short' : 'long');
    if (compactShort) return `${signo}${numStr}`;
  } else if (mode === 'price') {
    numStr = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(abs);
  } else {
    const decimales = abs < 100 && abs > 0 ? 2 : 0;
    numStr = new Intl.NumberFormat('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(abs);
  }

  return `${signo}${prefix}${NBSP}${numStr}`;
}

interface FormatPercentOptions {
  /** Antepone "+" a valores positivos (default true: así se usan casi todas las variaciones). */
  sign?: boolean;
  decimals?: number;
  hidden?: boolean;
  /** Puntos porcentuales ("+3,5 pp") en vez de "%". */
  pp?: boolean;
}

export function formatPercent(value: number | null | undefined, options: FormatPercentOptions = {}): string {
  const { sign = true, decimals = 1, hidden = false, pp = false } = options;
  if (hidden) return MASK;
  if (value == null || Number.isNaN(value)) return 's/d';

  const signo = sign && value >= 0 ? '+' : '';
  const numStr = new Intl.NumberFormat('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  return pp ? `${signo}${numStr}${NBSP}pp` : `${signo}${numStr}%`;
}

interface FormatNumberOptions {
  decimals?: number;
  hidden?: boolean;
  /** Notación compacta ("1,2 mil") para ejes y espacios chicos. */
  compact?: boolean;
}

/** Número es-AR sin moneda (ratios, duration, z-scores, tipos de cambio). */
export function formatNumber(value: number | null | undefined, options: FormatNumberOptions = {}): string {
  const { decimals = 0, hidden = false, compact = false } = options;
  if (hidden) return MASK;
  if (value == null || Number.isNaN(value)) return 's/d';
  if (compact) return compactNumber(value);
  return new Intl.NumberFormat('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

/** Tipo de cambio con etiqueta explícita, ej. formatFx(1500) → "1.500 ARS/USD". */
export function formatFx(value: number | null | undefined, options: { hidden?: boolean; decimals?: number } = {}): string {
  const { hidden = false, decimals = 0 } = options;
  if (hidden) return MASK;
  if (value == null || Number.isNaN(value)) return 's/d';
  const numStr = new Intl.NumberFormat('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  return `${numStr}${NBSP}ARS/USD`;
}

/**
 * "Ticks lindos" para un dominio [min,max]: pasos redondos (1/2/2.5/5 × 10^n)
 * que caen en valores legibles ("0, 10 mil, 20 mil") en vez de redondear cada
 * etiqueta por separado (lo que antes producía "6.5k" → "7k" engañoso).
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const rawStep = span / Math.max(count - 1, 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const niceNormalized = normalized >= 5 ? 10 : normalized >= 2.5 ? 5 : normalized >= 2 ? 2.5 : normalized >= 1 ? 2 : 1;
  const step = niceNormalized * magnitude;

  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step * 0.001; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}

/** Convierte y formatea un monto que solo existe en USD (ej. aportes), usando el MEP del mes. */
export function formatMonto(usd: number, moneda: Moneda, mepValor: number | null | undefined, options: Omit<FormatMoneyOptions, 'currency'> = {}): string {
  if (moneda === 'USD') return formatMoney(usd, { ...options, currency: 'USD' });
  if (mepValor == null) return `${CURRENCY_PREFIX.ARS}${NBSP}s/d`;
  return formatMoney(usd * mepValor, { ...options, currency: 'ARS' });
}

/** Elige entre un valor que ya tiene ambas monedas disponibles (ej. tenencias, total_cartera). */
export function valorSegunMoneda(usd: number, ars: number, moneda: Moneda): number {
  return moneda === 'ARS' ? ars : usd;
}
