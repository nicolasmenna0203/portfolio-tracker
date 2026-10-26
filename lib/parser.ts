/**
 * Parsea números en formato argentino: "1.234,56" → 1234.56
 * Funciona con strings formateados de Google Sheets (FORMATTED_VALUE).
 */
export function parseArgNum(val: unknown): number | null {
  if (typeof val === 'number') return val;
  if (!val) return null;

  let s = String(val).trim().replace(/\u00a0/g, '').replace(/\s/g, '');
  if (!s || s === '-') return null;

  if (s.includes(',')) {
    // "1.234,56" → "1234.56"
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
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

// ── Entidades HTML ────────────────────────────────────────────────────────────
// Los títulos de noticias llegan escapados: Yahoo (v1/finance/search) devuelve
// `&quot;` en los titulares y los RSS de Ámbito pasan por un parser propio que
// tampoco desescapa. Se decodifica a mano en vez de usar innerHTML sobre un
// elemento temporal: eso ejecutaría el markup que venga en el feed.
const ENTIDADES_HTML: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: '\u00a0', ndash: '–', mdash: '—', hellip: '…',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
};

/**
 * Decodifica entidades HTML nombradas y numéricas (decimales y hex) en una sola
 * pasada. Una sola pasada es deliberado: evita desescapar de más un texto que
 * venía doble-escapado a propósito. Las entidades desconocidas se dejan tal cual.
 */
export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, code: string) => {
    if (code[0] === '#') {
      const cp = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      // Fuera del rango Unicode o surrogate suelto: se deja la entidad literal.
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return match;
      return String.fromCodePoint(cp);
    }
    return ENTIDADES_HTML[code.toLowerCase()] ?? match;
  });
}
