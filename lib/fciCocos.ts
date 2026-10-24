import { inflateRawSync } from 'zlib';

// Decisión y alternativas descartadas: docs/decisiones/0005-parsear-cafci-con-zlib-nativo.md
// Por qué los rendimientos son `number | null` y no `number`:
// docs/decisiones/0019-sin-dato-no-es-cero-en-rendimientos-de-fci.md
// Por qué hay dos mapeos de fondos (FCI y renta variable):
// docs/decisiones/0020-fuente-de-precio-por-naturaleza-del-instrumento.md
//
// ── FCI del broker, vía la Planilla Diaria pública de CAFCI ────────────────
//
// CAFCI (Cámara Argentina de Fondos Comunes de Inversión) publica sin auth
// un .xlsx con el universo completo de FCI del país, actualizado a diario:
// https://api.pub.cafci.org.ar/pb_get (linkeado desde cafci.org.ar, botón
// "Descarga de la última planilla diaria"). Se filtra por Sociedad Gerente
// "Cocos Asset Management S.A.". No hay API JSON pública: la de Cocos exige
// login de broker y la de CAFCI (api.cafci.org.ar) devuelve 401 sin
// documentación de auth — esta planilla es la única fuente sin credenciales.
//
// Ojo con el rezago: la planilla no publica todos los fondos al mismo día.
// Algunos (típicamente los de valuación no diaria) aparecen con la fecha del
// día hábil anterior y con **todas** las columnas de comparación vacías —
// VCP anterior, variación diaria, mes, año y 12 meses. Por eso los
// rendimientos son `number | null` y no `number`: leer esas celdas como 0
// convertía "CAFCI no lo informó" en "el fondo no rindió nada", que para un
// fondo en dólares es un dato falso y verosímil a la vez.
//
// El .xlsx es un ZIP (DEFLATE) con XML adentro; se parsea a mano con el
// zlib nativo de Node en vez de agregar una librería de xlsx: el paquete
// "xlsx" (SheetJS) en npm está clavado en 0.18.5 con dos CVEs high sin
// parche publicado ahí (prototype pollution, ReDoS) — las versiones
// parcheadas solo se distribuyen desde el CDN propio de SheetJS, fuera de
// npm. El formato de fila/celda del XML es estable y simple (celdas de
// texto inline, sin sharedStrings), así que un parser mínimo evita esa
// dependencia.

/** Ticker cartera (Sheet) → nombre exacto de fondo+clase en la planilla CAFCI. Confirmado con el usuario. */
const MAPEO_FCI_COCOS: Record<string, string> = {
  COCORMA:    'Cocos Rendimiento - Clase A',
  COCOAUSD:   'Cocos Ahorro Dólares - Clase A',
  COCOUSDPA:  'Cocos Dólares Plus - Clase A',
  COCOSPPA:   'Cocos Pesos Plus - Clase A',
};

// Fondos de la misma planilla que el Sheet clasifica como renta variable
// (TIPO=ETF), no como FCI. Van en un mapa aparte a propósito: la pestaña de FCI
// lista `MAPEO_FCI_COCOS` y tiene que seguir contando solo los fondos que el
// usuario considera FCI, mientras la de Renta Variable resuelve estos por acá.
// La clasificación del Sheet no se toca; lo único que cambia es de qué fuente
// sale el precio, que se elige por naturaleza del instrumento.
const MAPEO_FCI_RENTA_VARIABLE: Record<string, string> = {
  COCOACCA:   'Cocos Acciones - Clase A',
};

export interface FciMetric {
  ticker: string;           // ticker cartera (ej. "COCORMA")
  nombreFondo: string;       // nombre completo en CAFCI (ej. "Cocos Rendimiento - Clase A")
  moneda: string;             // ARS o USD
  horizonte: string;          // "Cor" (corto), "Med" (medio), "Lar" (largo) plazo
  vcp: number;                  // valor de la cuotaparte, moneda del fondo
  // Los rendimientos son `null` cuando la planilla no los publica para esa fila
  // (celda vacía). No son 0: un fondo rezagado trae el VCP pero sin ninguna
  // columna de comparación, y mostrar 0,0% ahí afirma "no rindió nada" sobre un
  // dato que CAFCI no informó. La UI y el MCP los muestran como "s/d".
  variacionDiaria: number | null;    // %, tanto por uno
  rendimientoMes: number | null;      // % desde el último cierre de mes, tanto por uno
  rendimientoAnio: number | null;      // % desde el cierre del año anterior, tanto por uno
  rendimiento12Meses: number | null;    // % interanual, tanto por uno
  patrimonio: number;                // patrimonio del fondo (clase), en moneda del fondo
  fecha: string;                      // "YYYY-MM-DD"
  /**
   * true si la fila viene con fecha anterior a la más reciente de la planilla:
   * CAFCI publica algunos fondos con un día de rezago y sin columnas de
   * comparación. Permite explicar en la UI por qué no hay rendimientos.
   */
  rezagado: boolean;
}

const CAFCI_PLANILLA_URL = 'https://api.pub.cafci.org.ar/pb_get';
const SOCIEDAD_GERENTE_COCOS = 'Cocos Asset Management S.A.';

let cache: { metrics: Map<string, FciMetric>; ts: number } | null = null;
const CACHE_MS = 6 * 60 * 60 * 1000; // 6 horas — la planilla se actualiza una vez por día hábil

// ── Descompresión ZIP mínima (solo lo que necesita un .xlsx: central directory + inflate) ──

interface ZipEntry {
  name: string;
  compMethod: number;
  compSize: number;
  localHeaderOffset: number;
}

function listZipEntries(buf: Buffer): ZipEntry[] {
  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('cafci xlsx: fin de directorio central no encontrado');

  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const cdEntries = buf.readUInt16LE(eocdOffset + 10);
  const entries: ZipEntry[] = [];
  let offset = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('cafci xlsx: directorio central malformado');
    const compMethod = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
    entries.push({ name, compMethod, compSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const lh = entry.localHeaderOffset;
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + nameLen + extraLen;
  const compData = buf.subarray(dataStart, dataStart + entry.compSize);
  if (entry.compMethod === 0) return Buffer.from(compData);
  if (entry.compMethod === 8) return inflateRawSync(compData);
  throw new Error(`cafci xlsx: método de compresión no soportado (${entry.compMethod})`);
}

// ── Parseo de filas/celdas del XML de la hoja ───────────────────────────────
// Formato de la planilla CAFCI: celdas de texto inline (t="str"><v>texto</v>),
// sin sharedStrings.xml. Cada <row> trae celdas dispersas (columnas vacías se
// omiten), por eso se indexa por letra de columna en vez de por posición.

function colLettersToIndex(letters: string): number {
  let idx = 0;
  for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1; // 0-based
}

function parseSheetRows(xml: string): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c r="([A-Z]+)\d+"[^>]*>(?:<v>([\s\S]*?)<\/v>)?<\/c>/g;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(xml))) {
    const cells: string[] = [];
    cellRe.lastIndex = 0;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const col = colLettersToIndex(cellMatch[1]);
      const raw = cellMatch[2] ?? '';
      cells[col] = raw
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    }
    rows.push(cells);
  }
  return rows;
}

function parseNum(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Igual que `parseNum` pero distingue "celda vacía" de "cero": las columnas de
 * variación y rendimiento vienen en blanco en los fondos que la planilla
 * publica con rezago, y ahí 0 sería un dato inventado.
 */
function parseNumOpt(v: string | undefined): number | null {
  if (v == null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Divide por 100 preservando el `null` (porcentaje → tanto por uno). */
function pctOpt(v: number | null): number | null {
  return v == null ? null : v / 100;
}

/**
 * Fecha de la planilla ("DD/MM/AA") a clave ordenable ("AAAA-MM-DD"), para
 * comparar el rezago entre filas sin depender del orden del archivo.
 */
function fechaOrdenable(f: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(f.trim());
  if (!m) return '';
  return `20${m[3]}-${m[2]}-${m[1]}`;
}

async function fetchPlanillaRows(): Promise<string[][]> {
  const res = await fetch(`${CAFCI_PLANILLA_URL}?d=${Date.now()}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36',
      'Referer': 'https://www.cafci.org.ar/',
    },
    signal: AbortSignal.timeout(15000), // planilla de ~1MB, más lenta que un JSON
  });
  if (!res.ok) throw new Error(`CAFCI planilla diaria: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const entries = listZipEntries(buf);
  const sheetEntry = entries.find((e) => e.name === 'xl/worksheets/sheet1.xml');
  if (!sheetEntry) throw new Error('CAFCI planilla diaria: hoja principal no encontrada en el .xlsx');

  const xml = readZipEntry(buf, sheetEntry).toString('utf8');
  return parseSheetRows(xml);
}

/**
 * Mapa ticker cartera → métricas del FCI (VCP, rendimientos, patrimonio) para
 * los fondos de Cocos Capital presentes en MAPEO_FCI_COCOS. Ignora el resto
 * del universo de ~4200 fondos que trae la planilla (de todas las gestoras).
 */
async function fetchTodasLasMetricas(): Promise<Map<string, FciMetric>> {
  if (cache && Date.now() - cache.ts < CACHE_MS) return cache.metrics;

  const rows = await fetchPlanillaRows();

  // Nombre de fondo+clase (columna A) → ticker cartera, para no recorrer las
  // ~4200 filas por cada uno de los tickers buscados. Se resuelven los dos
  // mapas en la misma pasada: es el mismo archivo de ~1MB para ambos.
  const nombreATicker = new Map<string, string>();
  for (const [ticker, nombre] of Object.entries({ ...MAPEO_FCI_COCOS, ...MAPEO_FCI_RENTA_VARIABLE })) {
    nombreATicker.set(nombre, ticker);
  }

  // Fecha más reciente de toda la planilla: es la del día de publicación, y
  // sirve de referencia para marcar como rezagadas las filas que quedaron un
  // día atrás (ver `rezagado` en FciMetric).
  let fechaMax = '';
  for (const row of rows) {
    const f = fechaOrdenable(row[4] ?? '');
    if (f > fechaMax) fechaMax = f;
  }

  const metrics = new Map<string, FciMetric>();
  for (const row of rows) {
    const nombreFondo = row[0];
    if (!nombreFondo) continue;
    const ticker = nombreATicker.get(nombreFondo);
    if (!ticker) continue;

    // Columnas de la planilla (0-based): A nombre, B moneda, D horizonte,
    // E fecha, F VCP actual, H var% diaria, J rend% mes, K rend% año,
    // L rend% 12 meses, O patrimonio actual.
    const fecha = row[4] ?? '';
    metrics.set(ticker, {
      ticker,
      nombreFondo,
      moneda: row[1] ?? '',
      horizonte: row[3] ?? '',
      vcp: parseNum(row[5]),
      variacionDiaria: pctOpt(parseNumOpt(row[7])),
      rendimientoMes: pctOpt(parseNumOpt(row[9])),
      rendimientoAnio: pctOpt(parseNumOpt(row[10])),
      rendimiento12Meses: pctOpt(parseNumOpt(row[11])),
      patrimonio: parseNum(row[14]),
      fecha,
      rezagado: fechaMax !== '' && fechaOrdenable(fecha) < fechaMax,
    });
  }

  cache = { metrics, ts: Date.now() };
  return metrics;
}

function subconjunto(todas: Map<string, FciMetric>, mapeo: Record<string, string>): Map<string, FciMetric> {
  const out = new Map<string, FciMetric>();
  for (const ticker of Object.keys(mapeo)) {
    const m = todas.get(ticker);
    if (m) out.set(ticker, m);
  }
  return out;
}

/**
 * Métricas de los fondos que el usuario clasifica como FCI. Es lo que alimenta
 * la pestaña de FCI y la tool `renta_fija_fci` del MCP.
 */
export async function fetchFciMetrics(): Promise<Map<string, FciMetric>> {
  return subconjunto(await fetchTodasLasMetricas(), MAPEO_FCI_COCOS);
}

/**
 * Métricas de los fondos CAFCI que la cartera clasifica como renta variable
 * (ver MAPEO_FCI_RENTA_VARIABLE). Separado de `fetchFciMetrics` para que la
 * pestaña de FCI siga contando solo los fondos de tipo FCI.
 */
export async function fetchFciMetricsRentaVariable(): Promise<Map<string, FciMetric>> {
  return subconjunto(await fetchTodasLasMetricas(), MAPEO_FCI_RENTA_VARIABLE);
}
