/**
 * Parsea números en formato argentino: "1.234,56" → 1234.56
 * Funciona con strings formateados de Google Sheets (FORMATTED_VALUE).
 */
export function parseArgNum(val: unknown): number | null {
  if (typeof val === 'number') return val;
  if (!val) return null;

  let s = String(val).trim().replace(/\u00a0/g, '').replace(/\s/g, '');
  if (!s || s === '-') return null;

  // Solo dígitos, separadores y signo: nada de unidades ni sufijos pegados.
  // `parseFloat("1717.80USD")` devuelve 1717.8 sin avisar — celdas así,
  // cargadas en la columna de ARS con el monto en dólares, se leyeron durante
  // meses como pesos y rompieron la serie en ARS. Un valor ambiguo tiene que
  // fallar fuerte, no adivinar.
  if (!/^[+-]?[\d.,]+$/.test(s)) return null;

  if (s.includes(',')) {
    // "1.234,56" → "1234.56"
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(s)) {
    // "50.000" → "50000"
    s = s.replace(/\./g, '');
  }

  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/**
 * Parsea fechas de día en formato ISO "2024-07-31" o argentino "31/07/2024" / "31/07/24".
 * Retorna timestamp UTC o null si no puede parsear.
 */
export function parseFechaDia(s: string): number | null {
  if (!s) return null;
  if (s.includes('-')) {
    const [y, m, d] = s.split('-').map(Number);
    return isNaN(d) ? null : Date.UTC(y, m - 1, d);
  }
  if (s.includes('/')) {
    const [d, m, y] = s.split('/').map(Number);
    return isNaN(d) ? null : Date.UTC(y < 100 ? 2000 + y : y, m - 1, d);
  }
  return null;
}

const MESES_ES: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sept: 9, oct: 10, nov: 11, dic: 12,
};

/**
 * Parsea "mar-24" o "mar-2024" a un timestamp UTC (primer día del mes).
 */
export function parseFechaMes(s: string): number | null {
  try {
    const partes = s.trim().toLowerCase().split('-');
    const mes = MESES_ES[partes[0]];
    let anio = parseInt(partes[1]);
    if (anio < 100) anio += 2000;
    if (!mes) return null;
    return Date.UTC(anio, mes - 1, 1);
  } catch {
    return null;
  }
}

/**
 * Formatea un timestamp a "mar-24"
 */
export function formatMesLabel(ts: number): string {
  const d = new Date(ts);
  const mes = d.toLocaleString('es-AR', { month: 'short', timeZone: 'UTC' });
  const anio = String(d.getUTCFullYear()).slice(2);
  return `${mes}-${anio}`;
}

/**
 * Formatea "YYYY-MM" key para agrupar por mes.
 */
export function toMesKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

