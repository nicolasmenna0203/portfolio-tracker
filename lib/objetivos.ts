// Decisión y alternativas descartadas: docs/decisiones/0017-objetivos-de-composicion-en-el-sheet.md
//
// ── Objetivos de composición de cartera ─────────────────────────────────────
//
// El % objetivo de cada categoría, por dimensión (tipo de activo, riesgo,
// moneda, tipo de renta, geografía). Es lo que la vista Rebalanceo de Tenencias
// compara contra la composición real para mostrar cuánto falta o sobra.
//
// Viven en la hoja `Objetivos` del Sheet y no en localStorage del navegador,
// que es donde estaban: ahí solo existían en el browser que los cargó, se
// perdían al limpiar datos del sitio y —lo que motivó la mudanza— el servidor
// MCP no podía leerlos, así que el asesor daba recomendaciones de rebalanceo
// sin conocer el objetivo contra el cual rebalancear.
//
// ── Layout de la hoja ───────────────────────────────────────────────────────
//
// Cada dimensión ocupa un bloque de dos columnas, separados por una columna
// vacía, para que la hoja se lea como cinco tablitas lado a lado en vez de
// como una lista larga donde el nombre de la dimensión se repite en cada fila:
//
//        A         B    C    D            E    F    G       H   ...
//   1  TIPO        %         RIESGO       %         MONEDA  %
//   2  ACCION      15        CONSERVADOR  7         USD     49
//   3  ALTS        10        MODERADO     55        PESO    26
//   ...
//   N  TOTAL      100        TOTAL       100        TOTAL  100
//
// La fila TOTAL la escribe el código como número (no como fórmula) porque el
// parser la tiene que poder distinguir y descartar al leer; una fórmula
// además se rompería al reescribir el bloque con menos categorías.
//
// El lector acepta también el formato anterior (columnas Dimension/Categoria/
// Porcentaje, una fila por categoría) para no perder datos ya guardados: se
// migran al layout nuevo en el primer guardado.

import { google } from 'googleapis';
import { getAuth, getAuthWrite, esHojaInexistente } from './sheets';

export const HOJA = 'Objetivos';

// Las dimensiones y su etiquetado viven en `dimensiones.ts`, que también usa el
// cliente; acá se re-exportan para los que ya las importaban de este módulo.
import { DIMENSIONES, type Dimension } from './dimensiones';
export { DIMENSIONES, type Dimension };

/** Encabezado legible de cada bloque. La clave interna va en un comentario aparte. */
const TITULO: Record<Dimension, string> = {
  TIPO: 'TIPO',
  RIESGO: 'RIESGO',
  MONEDA: 'MONEDA',
  RENTA: 'RENTA',
  SECTOR_GEO: 'GEOGRAFIA',
};

/** Título del bloque → dimensión, para poder releer lo que se escribió. */
const POR_TITULO = new Map<string, Dimension>(
  DIMENSIONES.map((d) => [TITULO[d], d]),
);

export function esDimension(v: string): v is Dimension {
  return (DIMENSIONES as readonly string[]).includes(v);
}

/** { TIPO: { "Acciones": 40, ... }, RIESGO: {...}, ... } */
export type ObjetivosPorDimension = Record<Dimension, Record<string, number>>;

function vacio(): ObjetivosPorDimension {
  return { TIPO: {}, RIESGO: {}, MONEDA: {}, RENTA: {}, SECTOR_GEO: {} };
}

/**
 * Acepta tanto "40" como "40,5" (formato argentino) y "40.5". El Sheet devuelve
 * strings ya formateados, y el separador decimal depende de su locale.
 */
function parsePct(raw: string): number | null {
  const limpio = String(raw ?? '').trim().replace('%', '').replace(',', '.');
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

// ── Lectura ──────────────────────────────────────────────────────────────────

/** Layout en bloques: se recorre la grilla cruda por pares de columnas. */
function parsearBloques(grid: string[][]): ObjetivosPorDimension {
  const out = vacio();
  const header = grid[0] ?? [];

  for (let col = 0; col < header.length; col++) {
    const dim = POR_TITULO.get((header[col] ?? '').trim().toUpperCase());
    if (!dim) continue;

    // La columna del % es la siguiente; las categorías arrancan en la fila 2.
    for (let fila = 1; fila < grid.length; fila++) {
      const categoria = (grid[fila]?.[col] ?? '').trim();
      if (!categoria || categoria.toUpperCase() === 'TOTAL') continue;
      const pct = parsePct(grid[fila]?.[col + 1] ?? '');
      if (pct == null) continue;
      out[dim][categoria] = pct;
    }
  }
  return out;
}

/** Formato anterior: filas Dimension | Categoria | Porcentaje. */
function parsearFilasLargas(grid: string[][]): ObjetivosPorDimension {
  const out = vacio();
  for (let i = 1; i < grid.length; i++) {
    const dim = (grid[i]?.[0] ?? '').trim().toUpperCase();
    const categoria = (grid[i]?.[1] ?? '').trim();
    const pct = parsePct(grid[i]?.[2] ?? '');
    if (!esDimension(dim) || !categoria || pct == null) continue;
    out[dim][categoria] = pct;
  }
  return out;
}

/**
 * Lee los objetivos del Sheet. Si la hoja no existe todavía devuelve la
 * estructura vacía en vez de fallar: es el estado normal antes del primer
 * guardado. Cualquier otro error falla: tomarlo como "sin objetivos" terminaría
 * guardando los valores por defecto encima de los reales (ADR 0029).
 */
export async function leerObjetivos(): Promise<ObjetivosPorDimension> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Falta env var SPREADSHEET_ID');

  let grid: string[][];
  try {
    const sheets = google.sheets({ version: 'v4', auth: getAuth() });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: `${HOJA}!A1:Z200`,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    grid = (res.data.values ?? []) as string[][];
  } catch (err) {
    if (esHojaInexistente(err)) return vacio();
    throw err;
  }

  if (grid.length === 0) return vacio();

  // El formato viejo se reconoce por su encabezado; cualquier otra cosa se
  // intenta leer como bloques.
  const primera = (grid[0]?.[0] ?? '').trim().toLowerCase();
  return primera === 'dimension' ? parsearFilasLargas(grid) : parsearBloques(grid);
}

// ── Escritura ────────────────────────────────────────────────────────────────

type SheetsApi = ReturnType<typeof google.sheets>;

/** Columnas de A a Z: el rango que usa la hoja. */
const COLUMNAS_HOJA = 26;

/** Crea la hoja si falta. Idempotente: si ya está, no hace nada. */
async function asegurarHoja(sheets: SheetsApi, id: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const existe = meta.data.sheets?.some((s) => s.properties?.title === HOJA);
  if (existe) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: id,
    requestBody: { requests: [{ addSheet: { properties: { title: HOJA } } }] },
  });
}

/**
 * Arma la grilla en bloques de dos columnas, uno por dimensión, con una
 * columna vacía de separación y una fila TOTAL al pie de cada bloque.
 */
export function construirGrilla(objetivos: ObjetivosPorDimension): string[][] {
  // Categorías ordenadas alfabéticamente: el orden de inserción del objeto es
  // arbitrario y hacía que la hoja cambiara de orden entre guardados.
  const bloques = DIMENSIONES.map((dim) => {
    const entradas = Object.entries(objetivos[dim] ?? {})
      .filter(([, pct]) => Number.isFinite(pct))
      .sort(([a], [b]) => a.localeCompare(b, 'es'));
    const total = entradas.reduce((s, [, pct]) => s + pct, 0);
    return { dim, entradas, total };
  });

  const alto = Math.max(0, ...bloques.map((b) => b.entradas.length));
  const grid: string[][] = [];

  // Encabezado
  const header: string[] = [];
  for (const b of bloques) header.push(TITULO[b.dim], '%', '');
  grid.push(header);

  // Categorías
  for (let i = 0; i < alto; i++) {
    const fila: string[] = [];
    for (const b of bloques) {
      const e = b.entradas[i];
      fila.push(e ? e[0] : '', e ? String(e[1]) : '', '');
    }
    grid.push(fila);
  }

  // Fila TOTAL, solo bajo los bloques que tienen algo cargado. Sirve de control
  // visual: si no da 100, la asignación está incompleta o excedida.
  if (alto > 0) {
    grid.push([]);
    const totales: string[] = [];
    for (const b of bloques) {
      const hay = b.entradas.length > 0;
      totales.push(hay ? 'TOTAL' : '', hay ? String(Math.round(b.total * 10) / 10) : '', '');
    }
    grid.push(totales);
  }

  return grid;
}

/**
 * Reemplaza todos los objetivos por los recibidos.
 *
 * Es un overwrite completo, no un merge: la UI siempre manda el set entero, y
 * mezclar dejaría categorías viejas colgadas cuando se renombra o elimina una.
 *
 * Primero escribe y después limpia lo que sobra por debajo: al revés, un error en
 * el segundo paso deja la hoja vacía (ADR 0029). Cada fila se completa hasta la
 * última columna porque la API no toca las celdas que no recibe, y quedarían
 * residuos de un guardado anterior más grande.
 */
export async function guardarObjetivos(objetivos: ObjetivosPorDimension): Promise<number> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Falta env var SPREADSHEET_ID');

  const sheets = google.sheets({ version: 'v4', auth: getAuthWrite() });
  await asegurarHoja(sheets, id);

  const grid = construirGrilla(objetivos).map((fila) =>
    Array.from({ length: COLUMNAS_HOJA }, (_, i) => fila[i] ?? ''));

  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${HOJA}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: grid },
  });
  await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: `${HOJA}!A${grid.length + 1}:Z200` });

  return DIMENSIONES.reduce((s, d) => s + Object.keys(objetivos[d] ?? {}).length, 0);
}

/** Normaliza cualquier objeto entrante al shape esperado, descartando basura. */
export function normalizar(input: unknown): ObjetivosPorDimension {
  const out = vacio();
  if (!input || typeof input !== 'object') return out;

  for (const [dim, cats] of Object.entries(input as Record<string, unknown>)) {
    const d = dim.trim().toUpperCase();
    if (!esDimension(d) || !cats || typeof cats !== 'object') continue;
    for (const [cat, val] of Object.entries(cats as Record<string, unknown>)) {
      const n = typeof val === 'number' ? val : Number(val);
      if (!Number.isFinite(n) || n < 0 || n > 100) continue;
      const nombre = cat.trim();
      if (nombre) out[d][nombre] = n;
    }
  }
  return out;
}
