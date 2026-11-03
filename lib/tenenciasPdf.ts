// Parser de la sección "POSICION AL CIERRE" del resumen mensual del broker.
//
// Las posiciones se suben a la hoja Tenencias. Los saldos en cuenta y el total del
// resumen solo se muestran en la vista previa: sirven para controlar la lectura
// (posiciones + saldos tiene que dar el total del PDF), no se guardan.
//
// El mes de la carga lo elige el usuario en la vista previa: la fecha del PDF no
// alcanza, porque un resumen con "Hasta" 01-11 trae en realidad el cierre de octubre.
// La hoja identifica cada mes por su último día, así que si el cierre del PDF no es
// ese día se avisa antes de confirmar (ver cierraElUltimoDia).

export interface ParsedRow {
  ticker: string;
  tenenciaARS: number;
  tenenciaUSD: number;
}

export interface SaldoRow {
  moneda: 'ARS' | 'USD MEP' | 'USD CABLE';
  montoEnMoneda: number; // puede ser negativo: el broker admite descubierto
  tenenciaARS: number;
  tenenciaUSD: number;
}

export interface ParsedPDF {
  fecha: string;    // "YYYY-MM-DD"
  dolarMep: number;
  rows: ParsedRow[];
  saldos: SaldoRow[];
  totalPosicionArs: number | null; // "Total Posición al", null si el PDF no lo trae
  pendienteLiquidacionArs: number | null; // fuera del total de la posición
}

/** Convierte número formato argentino "1.234.567,89" → 1234567.89 */
function parseArgNum(s: string): number {
  return parseFloat(s.replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, ''));
}

/** Último día de un mes "YYYY-MM", como "DD/MM/YYYY": la fecha con la que se guarda en la hoja. */
export function ultimoDiaDelMes(mesKey: string): string {
  const [yyyy, mm] = mesKey.split('-').map(Number);
  const dd = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
  return `${String(dd).padStart(2, '0')}/${String(mm).padStart(2, '0')}/${yyyy}`;
}

/** ¿El cierre del PDF ("YYYY-MM-DD") es justo el último día del mes elegido? */
export function cierraElUltimoDia(fechaCierre: string, mesKey: string): boolean {
  const [yyyy, mm, dd] = fechaCierre.split('-');
  return ultimoDiaDelMes(mesKey) === `${dd}/${mm}/${yyyy}`;
}

/**
 * Tira error si `ddmmyyyy` ("31-10-2026") no es el último día de su mes. Lo usa la
 * carga de movimientos, donde el mes sale del período del PDF: uno parcial marcaría
 * el mes como cargado y bloquearía el resumen completo.
 */
export function exigirFinDeMes(ddmmyyyy: string): void {
  const [dd, mm, yyyy] = ddmmyyyy.split('-').map(Number);
  if (new Date(Date.UTC(yyyy, mm, 0)).getUTCDate() === dd) return;
  throw new Error(`El resumen cierra el ${ddmmyyyy}, no a fin de mes. Generalo con "Hasta" en el último día del mes.`);
}

export function parseResumenBroker(fullText: string): ParsedPDF {
  // ── 1. Extraer dólar MEP ──────────────────────────────────────────────────
  const mepMatch = fullText.match(/cotizaci[oó]n\s+D[oó]lar\s+MEP\s+([\d.,]+)/i);
  const dolarMep = mepMatch ? parseArgNum(mepMatch[1]) : 0;

  // ── 2. Encontrar la última sección "POSICION AL CIERRE DEL" ──────────────
  const posRegex = /POSICION AL CIERRE DEL\s+(\d{2}-\d{2}-\d{4})/gi;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = posRegex.exec(fullText)) !== null) lastMatch = m;

  if (!lastMatch) throw new Error('No se encontró sección POSICION AL CIERRE en el PDF');

  const [dd, mm, yyyy] = lastMatch[1].split('-');
  const fecha = `${yyyy}-${mm}-${dd}`;

  // ── 3. Extraer texto desde esa sección hasta el Total ────────────────────
  const startIdx = lastMatch.index;
  const endMarker = fullText.indexOf('Total Posición al', startIdx);
  const section = endMarker > 0
    ? fullText.slice(startIdx, endMarker)
    : fullText.slice(startIdx);

  const pie = endMarker > 0 ? fullText.slice(endMarker) : '';
  const totalMatch = pie.match(/^Total Posición al\s+\d{2}-\d{2}-\d{4}\s+(?:ARS\s+)?(-?[\d.,]+)/);
  const totalPosicionArs = totalMatch ? parseArgNum(totalMatch[1]) : null;
  const pendienteMatch = pie.match(/Posición pendiente de liquidación al\s+\d{2}-\d{2}-\d{4}\s+(?:ARS\s+)?(-?[\d.,]+)/);
  const pendienteLiquidacionArs = pendienteMatch ? parseArgNum(pendienteMatch[1]) : null;

  const aUsd = (moneda: string, totalEnMoneda: number, totalARS: number) => {
    if (moneda === 'ARS') return dolarMep > 0 ? totalARS / dolarMep : 0;
    return totalEnMoneda;
  };

  // ── 4. Parsear filas ──────────────────────────────────────────────────────
  // Patrón: nombre (TICKER)   cantidad   MONEDA   precio   totalMoneda   totalARS
  // El texto tiene múltiples espacios como separadores
  // Estrategia: buscar secuencias con ticker entre paréntesis seguidas de números y moneda

  const rows: ParsedRow[] = [];

  // Regex: (TICKER) cantidad MONEDA precio totalMoneda totalARS
  const rowRegex = /\(([A-Z0-9]+)\) ([\d.,]+) (ARS|USD MEP|USD CABLE) [\d.,]+ ([\d.,]+) ([\d.,]+)\*{0,2}/g;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(section)) !== null) {
    const ticker = rowMatch[1];
    const moneda = rowMatch[3];
    const totalEnMoneda = parseArgNum(rowMatch[4]);
    const totalARS = parseArgNum(rowMatch[5]);

    // Ignorar saldos de efectivo por contexto previo
    const before = section.slice(Math.max(0, rowMatch.index - 20), rowMatch.index);
    if (/Saldo\s+(ARS|USD)/.test(before)) continue;
    if (['ARS', 'MEP', 'CABLE'].includes(ticker)) continue;

    rows.push({ ticker, tenenciaARS: totalARS, tenenciaUSD: aUsd(moneda, totalEnMoneda, totalARS) });
  }

  if (rows.length === 0) throw new Error('No se pudieron extraer instrumentos del PDF');

  // ── 5. Parsear saldos en cuenta ───────────────────────────────────────────
  // Sin ticker ni precio: "Saldo USD MEP   -12,34   USD MEP   -12,34   -18.000,00*"
  const saldos: SaldoRow[] = [];
  const saldoRegex = /Saldo\s+(ARS|USD MEP|USD CABLE)\s+-?[\d.,]+\s+(?:ARS|USD MEP|USD CABLE)\s+(-?[\d.,]+)\s+(-?[\d.,]+)\*{0,2}/g;

  let saldoMatch: RegExpExecArray | null;
  while ((saldoMatch = saldoRegex.exec(section)) !== null) {
    const moneda = saldoMatch[1] as SaldoRow['moneda'];
    const totalEnMoneda = parseArgNum(saldoMatch[2]);
    const totalARS = parseArgNum(saldoMatch[3]);
    saldos.push({
      moneda,
      montoEnMoneda: totalEnMoneda,
      tenenciaARS: totalARS,
      tenenciaUSD: aUsd(moneda, totalEnMoneda, totalARS),
    });
  }

  return { fecha, dolarMep, rows, saldos, totalPosicionArs, pendienteLiquidacionArs };
}
