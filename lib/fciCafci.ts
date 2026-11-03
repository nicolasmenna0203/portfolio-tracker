import { inflateRawSync } from 'zlib';
import { rendimiento12MesesVia } from './fciHistorico';
import { parsearFondos, RANGO_FONDOS_CAFCI, type FondoCafci } from './fondosCafci';
import { readSheet } from './sheets';

// Decisión y alternativas descartadas: docs/decisiones/0005-parsear-cafci-con-zlib-nativo.md
// Por qué los rendimientos son `number | null` y no `number`:
// docs/decisiones/0019-sin-dato-no-es-cero-en-rendimientos-de-fci.md
// Por qué algunos fondos salen por renta variable y no por FCI:
// docs/decisiones/0020-fuente-de-precio-por-naturaleza-del-instrumento.md
// Por qué el 12 meses de un fondo rezagado se completa con una fuente aparte,
// y por qué mes/año no: docs/decisiones/0021-fuente-secundaria-para-12-meses-de-fci-rezagado.md
//
// ── FCI del broker, vía la Planilla Diaria pública de CAFCI ────────────────
//
// CAFCI (Cámara Argentina de Fondos Comunes de Inversión) publica sin auth
// un .xlsx con el universo completo de FCI del país, actualizado a diario:
// https://api.pub.cafci.org.ar/pb_get (linkeado desde cafci.org.ar, botón
// "Descarga de la última planilla diaria"). Se buscan por nombre exacto los
// fondos de la hoja FondosCAFCI. No hay API JSON pública: la del broker exige
// login y la de CAFCI (api.cafci.org.ar) devuelve 401 sin documentación de auth —
// esta planilla es la única fuente sin credenciales.
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

// Qué fondos buscar sale de la hoja FondosCAFCI (ver lib/fondosCafci.ts). Los que
// el Sheet clasifica como renta variable se devuelven aparte: la pestaña de FCI
// tiene que seguir contando solo los fondos que el usuario considera FCI. La
// clasificación del Sheet no se toca; lo único que cambia es de qué fuente sale
// el precio, que se elige por naturaleza del instrumento.
async function leerFondos(): Promise<Record<string, FondoCafci>> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Falta env var SPREADSHEET_ID');
  const fondos = parsearFondos(await readSheet(id, RANGO_FONDOS_CAFCI));
  if (Object.keys(fondos).length === 0) {
    // console.warn va a stderr: el MCP usa stdout para JSON-RPC.
    console.warn('La hoja FondosCAFCI no tiene fondos: no se busca nada en CAFCI');
  }
  return fondos;
}

export interface FciMetric {
  ticker: string;           // ticker cartera
  nombreFondo: string;       // nombre completo en CAFCI, fondo y clase
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
  fecha: string;                      // "DD/MM/AA", como lo publica la planilla
  /**
   * true si la fila viene con fecha anterior a la más reciente de la planilla:
   * CAFCI publica algunos fondos con un día de rezago y sin columnas de
   * comparación. Permite explicar en la UI por qué no hay rendimientos.
   */
  rezagado: boolean;
  /**
   * true si `rendimiento12Meses` no vino de la columna de CAFCI (estaba vacía
   * por rezago) sino que se completó con el VCP de hace 12 meses del espejo de
   * argentinadatos. Ver docs/decisiones/0021-fuente-secundaria-para-12-meses-de-fci-rezagado.md.
   * false en todos los demás campos y en todos los fondos no rezagados.
   */
  rendimiento12MesesEstimado: boolean;
}

const CAFCI_PLANILLA_URL = 'https://api.pub.cafci.org.ar/pb_get';

interface Metricas {
  metrics: Map<string, FciMetric>;
  fondos: Record<string, FondoCafci>;
}

let cache: (Metricas & { ts: number }) | null = null;
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
 * los fondos de la hoja FondosCAFCI. Ignora el resto del universo de ~4200
 * fondos que trae la planilla (de todas las gestoras).
 */
async function fetchTodasLasMetricas(): Promise<Metricas> {
  if (cache && Date.now() - cache.ts < CACHE_MS) return cache;

  // Sin fondos configurados no hay nada que buscar en un archivo de ~1MB.
  const fondos = await leerFondos();
  if (Object.keys(fondos).length === 0) return { metrics: new Map(), fondos };

  const rows = await fetchPlanillaRows();

  // Nombre de fondo+clase (columna A) → ticker cartera, para no recorrer las
  // ~4200 filas por cada uno de los tickers buscados.
  const nombreATicker = new Map<string, string>();
  for (const [ticker, { nombre }] of Object.entries(fondos)) {
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
      rendimiento12MesesEstimado: false,
    });
  }

  await completar12MesesRezagados(metrics, fondos);

  cache = { metrics, fondos, ts: Date.now() };
  return cache;
}

/**
 * Para los fondos con `rendimiento12Meses == null` (columna vacía en CAFCI)
 * que tienen `categoriaHistorico` configurada, intenta completarlo
 * con el VCP de hace 12 meses del espejo de argentinadatos. Muta `metrics` en
 * el lugar; no hace nada si no hay categoría mapeada o si la fuente no
 * encuentra el punto de hace un año dentro de su tolerancia.
 */
async function completar12MesesRezagados(metrics: Map<string, FciMetric>, fondos: Record<string, FondoCafci>): Promise<void> {
  const fechaHoyISO = (() => {
    // La fecha de la planilla viene "DD/MM/AA"; se toma la de cualquier fondo
    // no rezagado (todos comparten el mismo día de publicación) como ancla.
    for (const m of metrics.values()) {
      const iso = fechaOrdenable(m.fecha);
      if (iso) return iso;
    }
    return '';
  })();
  if (!fechaHoyISO) return;

  await Promise.all(
    Object.entries(fondos).map(async ([ticker, { categoriaHistorico: categoria }]) => {
      const m = metrics.get(ticker);
      if (!m || m.rendimiento12Meses != null || !categoria) return;

      const rend = await rendimiento12MesesVia(categoria, m.nombreFondo, m.vcp, fechaHoyISO).catch(() => null);
      if (rend != null) {
        m.rendimiento12Meses = rend;
        m.rendimiento12MesesEstimado = true;
      }
    }),
  );
}

function subconjunto({ metrics, fondos }: Metricas, rentaVariable: boolean): Map<string, FciMetric> {
  const out = new Map<string, FciMetric>();
  for (const [ticker, m] of metrics) {
    if (fondos[ticker]?.rentaVariable === rentaVariable) out.set(ticker, m);
  }
  return out;
}

/**
 * Métricas de los fondos que el usuario clasifica como FCI. Es lo que alimenta
 * la pestaña de FCI y la tool `renta_fija_fci` del MCP.
 */
export async function fetchFciMetrics(): Promise<Map<string, FciMetric>> {
  return subconjunto(await fetchTodasLasMetricas(), false);
}

/**
 * Métricas de los fondos CAFCI que la cartera clasifica como renta variable
 * (columna RENTA_VARIABLE de la hoja). Separado de `fetchFciMetrics` para que la
 * pestaña de FCI siga contando solo los fondos de tipo FCI.
 */
export async function fetchFciMetricsRentaVariable(): Promise<Map<string, FciMetric>> {
  return subconjunto(await fetchTodasLasMetricas(), true);
}
