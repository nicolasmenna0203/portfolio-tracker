import { parseArgNum as parseArgNumOrNull } from './parser';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseArgNum(s: string): number {
  return parseArgNumOrNull(s) ?? NaN;
}

/** "31/01/24" → "31/01/2024" */
function formatFecha(ddmmyy: string): string {
  const [dd, mm, yy] = ddmmyy.split('/');
  const yyyy = yy.length === 2 ? `20${yy}` : yy;
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Prefijos de trámite que anteceden al nombre del empleador (o lo reemplazan
 * cuando el banco no informa razón social) según el canal de pago. El banco
 * ya usó al menos tres formatos distintos para el mismo tipo de acreditación
 * ("Acreditacion de haberes", "Acreditacion haberes debin", "Pago haberes
 * interbanking externa") — se listan por canal en vez de intentar adivinar
 * un patrón único, porque el banco los cambia sin aviso.
 */
const PREFIJOS_TRAMITE = [
  /\binterbanking\s+externa\b/gi,
  /\bid\s+debin\s+\S+/gi, // ID alfanumérico del DEBIN, no tiene valor como nombre
  /\bdebin\b/gi,
];

/**
 * Limpia el nombre del empleador extraído de la línea de acreditación de haberes.
 * El texto trae basura pegada: prefijos de trámite (ver PREFIJOS_TRAMITE), un
 * código de lote ("240130007"), a veces un dígito de sufijo pegado al final
 * ("empresa uno sa2"), y el CUIT del empleador. El nombre, cuando existe,
 * puede ir antes O después del CUIT según el canal de pago — no se asume una
 * posición fija, solo se remueve todo lo puramente numérico/ruido y se conserva
 * cualquier texto alfabético a los lados.
 *
 * Si tras limpiar no queda ningún texto alfabético (típico en DEBIN, donde el
 * banco no informa la razón social), se usa "CUIT <número>" como placeholder:
 * así la fila no se descarta y el usuario puede corregirla en el paso de
 * "empleador nuevo" antes de confirmar la carga.
 */
export function limpiarEmpleador(raw: string): string {
  let s = raw.trim();
  for (const p of PREFIJOS_TRAMITE) s = s.replace(p, ' ');

  const cuitMatch = s.match(/\b(\d{2}-?\d{8}-?\d)\b/);
  // CUIT (11 dígitos, con o sin guiones) en cualquier posición
  s = s.replace(/\b\d{2}-?\d{8}-?\d\b/g, ' ');
  // "cuit" suelto
  s = s.replace(/\bcuit\b/gi, ' ');
  // Código de lote/comprobante: 5+ dígitos, pegados a una palabra o sueltos
  // (ej. "240130007empresa...", o el comprobante fragmentado "02 30851 67").
  s = s.replace(/\d{5,}/g, ' ');
  // Grupos cortos de solo dígitos sueltos entre espacios (ej. "02", "67" del
  // comprobante fragmentado) — pero no números pegados a letras, esos se tratan
  // aparte para no comerse un nombre real que empiece con dígito.
  s = s.replace(/(?<=\s|^)\d{1,4}(?=\s|$)/g, ' ');
  // Dígito de sufijo pegado a una palabra (ej. "uno sa2" → "uno sa")
  s = s.replace(/([a-záéíóúñ])\d+\b/gi, '$1');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s && cuitMatch) return `CUIT ${cuitMatch[1]}`;
  return s;
}

// ── Parser ────────────────────────────────────────────────────────────────────

export interface HaberRow {
  fecha: string;       // "DD/MM/YYYY"
  empleador: string;
  montoArs: number;
  montoUsd: number;
}

export interface ParsedHaberes {
  mesesKeys: string[];  // "YYYY-MM" de cada mes con al menos un haber detectado
  rows: HaberRow[];
}

/**
 * Extrae acreditaciones de haberes de un resumen de cuenta bancario. Busca
 * líneas dentro de "Movimientos en pesos" y "Movimientos en dólares" que
 * contienen la palabra "haberes" en el concepto del movimiento — sin fijar el
 * texto exacto del concepto, porque el banco ya usó al menos tres formatos
 * distintos para el mismo tipo de acreditación:
 *
 * Los ejemplos son sintéticos: mismo formato que los resúmenes reales, con
 * razones sociales y CUIT ficticios.
 *
 * Transferencia directa (el nombre va DESPUÉS del CUIT, pegado a un código de lote):
 * "31/01/24 67332701 Acreditacion de haberes 30111111111 240130007empresa uno sa $ 276.000,00 $ 276.000,67"
 *
 * DEBIN (sin razón social, solo un ID de transacción y el CUIT —
 * limpiarEmpleador() cae a "CUIT <número>"):
 * "08/07/26 89653638 Acreditacion haberes debin Id debin a1b2c3d4e5f6g7h8i9j0k1 cuit 30222222222 $ 1.900.000,00 $ 1.900.000,40"
 *
 * Interbanking externa (el nombre va ANTES del CUIT, seguido de un comprobante
 * bancario fragmentado con espacios — "02 30851 67"):
 * "05/12/25 3085167 Pago haberes interbanking externa Empresa dos srl 30222222222 02 30851 67 $ 1.500.000,00 $ 1.500.446,34"
 *
 * En los tres casos: FECHA | COMPROBANTE | concepto con "haberes" | [nombre]+[CUIT]+ruido | $ MONTO | $ SALDO
 *
 * Si ninguna línea de movimiento matchea, se prueba como fallback el formato
 * de comprobante individual de transferencia (ver parseComprobanteIndividual):
 * un PDF de una sola operación (ej. "Office Banking"), sin tabla de movimientos.
 */
export function parseHaberesText(fullText: string): ParsedHaberes {
  const rows: HaberRow[] = [];

  // Cada línea de movimiento arranca con "DD/MM/YY " — partimos el texto en
  // bloques por esa marca, igual que el parser de Movimientos del broker.
  const dateSplitRegex = /(?=\d{2}\/\d{2}\/\d{2}\s)/g;
  const chunks = fullText.split(dateSplitRegex).filter((c) => /^\d{2}\/\d{2}\/\d{2}\s/.test(c));

  // Dentro de cada bloque con la palabra "haberes": fecha, luego el concepto
  // (hasta 5 palabras que preceden a "haberes" + "haberes" + hasta 3 palabras
  // después, para no capturar frases largas), luego el resto hasta el primer
  // monto en $ (empleador+ruido), luego el monto. El monto de la acreditación
  // es el primero en $ tras el concepto (el segundo $ es el saldo de cuenta).
  // No se enumeran variantes exactas de concepto ("Acreditacion de haberes",
  // "Acreditacion haberes debin", "Pago haberes interbanking externa", etc.)
  // porque el banco las cambia sin aviso — cualquier frase corta con "haberes"
  // en el movimiento se toma como acreditación de sueldo.
  const chunkRegex = /^(\d{2}\/\d{2}\/\d{2})\s+\d+\s+((?:\S+\s+){0,4}haberes(?:\s+\S+){0,3}?)\s+([\s\S]*?)\s*\$\s*([-\d.,]+)\s*\$/i;

  for (const chunk of chunks) {
    const m = chunkRegex.exec(chunk.trim());
    if (!m) continue;

    const fecha = formatFecha(m[1]);
    const empleador = limpiarEmpleador(m[3]);
    const montoArs = parseArgNum(m[4]);

    if (!empleador || isNaN(montoArs) || montoArs <= 0) continue;

    rows.push({ fecha, empleador, montoArs, montoUsd: 0 });
  }

  // Movimientos en dólares: mismo patrón de línea, pero el monto viene en USD.
  const usdSectionStart = fullText.indexOf('Movimientos en dólares');
  if (usdSectionStart !== -1) {
    const usdSection = fullText.slice(usdSectionStart);
    const usdChunks = usdSection.split(dateSplitRegex).filter((c) => /^\d{2}\/\d{2}\/\d{2}\s/.test(c));
    for (const chunk of usdChunks) {
      const m = chunkRegex.exec(chunk.trim());
      if (!m) continue;

      const fecha = formatFecha(m[1]);
      const empleador = limpiarEmpleador(m[3]);
      const montoUsd = parseArgNum(m[4]);

      if (!empleador || isNaN(montoUsd) || montoUsd <= 0) continue;

      rows.push({ fecha, empleador, montoArs: 0, montoUsd });
    }
  }

  // Comprobante individual de transferencia (ej. "Office Banking" de un banco):
  // no tiene tabla de movimientos, son campos sueltos (Concepto, Fecha de envío,
  // Monto, CUIT/CUIL, Razón Social). Se intenta solo si no hubo matches de
  // extracto de cuenta, para no interferir con ese formato.
  if (rows.length === 0) {
    const comprobante = parseComprobanteIndividual(fullText);
    if (comprobante) rows.push(comprobante);
  }

  if (rows.length === 0) throw new Error('No se encontraron acreditaciones de haberes en el PDF');

  const mesesKeys = Array.from(new Set(rows.map((r) => {
    const [dd, mm, yyyy] = r.fecha.split('/');
    return `${yyyy}-${mm}`;
  }))).sort();

  return { mesesKeys, rows };
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * Comprobante individual de transferencia (ej. "Office Banking" de un banco),
 * a diferencia del extracto de cuenta: acá no hay tabla de movimientos, son
 * campos etiqueta→valor sueltos ("Concepto" / "Acreditamiento De Haberes",
 * "Fecha de envío" / "DD/MM/YYYY", "Monto" / "$ N", CUIT/razón social del
 * pagador). Se usa el CUIT/razón social del PAGADOR (el empleador), no del
 * destinatario (el titular de la cuenta). Devuelve null si no matchea el
 * formato, para que el llamador pruebe otras alternativas o tire el error
 * genérico.
 *
 * El sueldo es de mes vencido: la "Fecha de envío" es cuando se hizo la
 * transferencia (ej. inicios de septiembre), pero el haber corresponde al mes
 * anterior, que el banco informa aparte en "Descripción" (ej. "AGOSTO 2026").
 * Se usa ese mes — con el día 1 — como fecha del haber, no la fecha de envío,
 * para que el haber caiga en el mes que realmente se trabajó.
 *
 * Fixture sintético (mismo formato que un comprobante real, datos ficticios):
 * "Identificador de la operación: X1 Datos del pago Tipo de transferencia
 * Nro. de Transferencia Sueldos 1 Fecha de envío Monto 15/04/2026 $ 500.000,00
 * Concepto Descripción Acreditamiento De Haberes MARZO 2026 Datos del pagador
 * CUIT/CUIL Razón Social 30333333333 EMPRESA TRES SA Cuenta a debitar ..."
 */
function parseComprobanteIndividual(fullText: string): HaberRow | null {
  if (!/acreditamiento\s+de\s+haberes/i.test(fullText)) return null;

  // "Fecha de envío" y "Monto" son etiquetas de columna consecutivas, seguidas
  // de sus valores en ese mismo orden ("15/04/2026 $ 500.000,00") — no dos
  // pares etiqueta→valor intercalados.
  const fechaMontoMatch = fullText.match(
    /fecha\s+de\s+env[ií]o\s+monto\s*(\d{2}\/\d{2}\/\d{4})\s*\$?\s*([\d.,]+)/i
  );
  if (!fechaMontoMatch) return null;

  const montoArs = parseArgNum(fechaMontoMatch[2]);
  if (isNaN(montoArs) || montoArs <= 0) return null;

  // Mes vencido informado en la descripción (ej. "AGOSTO 2026"). Si no aparece
  // en ese formato, se cae a la fecha de envío tal cual, para no descartar
  // comprobantes con una descripción distinta.
  const mesVencidoMatch = fullText.match(
    new RegExp(`\\b(${MESES.join('|')})\\s+(\\d{4})\\b`, 'i')
  );
  let fecha = fechaMontoMatch[1];
  if (mesVencidoMatch) {
    const mesIdx = MESES.indexOf(mesVencidoMatch[1].toLowerCase());
    const mm = String(mesIdx + 1).padStart(2, '0');
    fecha = `01/${mm}/${mesVencidoMatch[2]}`;
  }

  // Razón social/CUIT del PAGADOR (el empleador). El PDF trae primero las
  // etiquetas de columna ("CUIT/CUIL", "Razón Social") y recién después los
  // valores en ese mismo orden ("30333333333 EMPRESA TRES SA").
  const pagadorMatch = fullText.match(
    /datos del pagador\s*cuit\/cuil\s*raz[oó]n social\s*(\d{2}-?\d{8}-?\d)\s*([a-záéíóúñ0-9 .,-]*?)(?:\s+cuenta a debitar|\s+datos del destinatario|$)/i
  );

  let empleador = '';
  if (pagadorMatch) empleador = limpiarEmpleador(pagadorMatch[2]) || (pagadorMatch[1] ? `CUIT ${pagadorMatch[1]}` : '');
  if (!empleador) return null;

  return { fecha, empleador, montoArs, montoUsd: 0 };
}
