// Decisión y alternativas descartadas: docs/decisiones/0041-historial-de-briefs-en-el-sheet.md
//
// ── Historial de briefs semanales ───────────────────────────────────────────
//
// El brief de noticias y fundamentales (lib/briefSemanal.ts) llega al job del
// domingo en el cuerpo del POST y, además de ir en el mail, se guarda acá para
// que la pestaña Brief del dashboard muestre la semana actual y las
// anteriores. El job ya escribe en el Sheet con la service account; leer el
// historial desde la rama privada del repo obligaría a darle a Vercel un token
// de GitHub.
//
// ── Layout de la hoja ───────────────────────────────────────────────────────
//
//        A           B                       C
//   1  FECHA       BRIEF                   GUARDADO
//   2  2026-01-10  {"fecha":"2026-01-10"…} 2026-01-11T15:30:00.000Z
//
// Una fila por semana, identificada por la fecha del brief. El job corre dos
// veces el domingo (ADR 0033) y puede recibir el mismo brief otra vez si la
// sesión del sábado no corrió: guardar reemplaza la fila de esa fecha en vez de
// agregar otra.
//
// BRIEF es el JSON tal como lo valida parsearBrief (con `a_vigilar`, la forma
// que escribe la sesión), así que leerlo pasa por el mismo validador: una
// celda editada a mano o rota se descarta sin tirar la pestaña.

import { google } from 'googleapis';
import { getAuth, getAuthWrite, esHojaInexistente } from './sheets';
import { parsearBrief, type BriefSemanal } from './briefSemanal';

export const HOJA = 'Briefs';
const ENCABEZADO = ['FECHA', 'BRIEF', 'GUARDADO'];
/** Filas que se leen: más de diez años de domingos. */
const MAX_FILAS = 600;
/**
 * Una celda de Google Sheets admite 50.000 caracteres. Los topes de
 * parsearBrief dejan un brief completo cerca de 60.000 en el peor caso, así
 * que se recorta con margen antes de escribir (ver `serializarParaCelda`).
 */
const MAX_CELDA = 49_000;

/** Brief validado → JSON con la forma original (la que lee parsearBrief). */
export function briefAJson(b: BriefSemanal): Record<string, unknown> {
  return {
    fecha: b.fecha,
    resumen: b.resumen,
    activos: b.activos,
    a_vigilar: b.aVigilar,
  };
}

/**
 * JSON para la celda, dentro del límite. Si no entra, primero se sacan las
 * fuentes (los links son lo que más ocupa y lo que menos se lee) y después los
 * últimos activos, que la sesión ordena de mayor a menor importancia.
 */
export function serializarParaCelda(b: BriefSemanal): string {
  let actual: BriefSemanal = b;
  let json = JSON.stringify(briefAJson(actual));
  if (json.length <= MAX_CELDA) return json;

  actual = { ...actual, activos: actual.activos.map((a) => ({ ...a, fuentes: [] })) };
  json = JSON.stringify(briefAJson(actual));
  while (json.length > MAX_CELDA && actual.activos.length > 0) {
    actual = { ...actual, activos: actual.activos.slice(0, -1) };
    json = JSON.stringify(briefAJson(actual));
  }
  return json;
}

/**
 * Grilla de la hoja → briefs válidos, del más nuevo al más viejo. Si hay dos
 * filas con la misma fecha gana la de más abajo, que es la última escrita.
 */
export function briefsDesdeGrilla(grid: string[][]): BriefSemanal[] {
  const porFecha = new Map<string, BriefSemanal>();
  for (let i = 1; i < grid.length; i++) {
    const celda = grid[i]?.[1];
    if (!celda) continue;
    let crudo: unknown;
    try {
      crudo = JSON.parse(celda);
    } catch {
      continue;
    }
    const brief = parsearBrief(crudo);
    if (brief) porFecha.set(brief.fecha, brief);
  }
  return [...porFecha.values()].sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/**
 * Fila (1-based, como en A1) donde va el brief de `fecha`: la que ya tiene esa
 * fecha, o la primera libre debajo de la última ocupada.
 */
export function filaDestino(columnaFechas: string[][], fecha: string): number {
  // columnaFechas[0] es el encabezado (fila 1).
  for (let i = 1; i < columnaFechas.length; i++) {
    if ((columnaFechas[i]?.[0] ?? '').trim() === fecha) return i + 1;
  }
  return Math.max(columnaFechas.length, 1) + 1;
}

// ── Lectura ──────────────────────────────────────────────────────────────────

/**
 * Todos los briefs guardados, del más nuevo al más viejo. Sin la hoja devuelve
 * lista vacía: es el estado normal antes del primer domingo. Cualquier otro
 * error falla, para que la pestaña muestre el error y no "no hay briefs".
 */
export async function leerBriefs(): Promise<BriefSemanal[]> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Falta env var SPREADSHEET_ID');

  try {
    const sheets = google.sheets({ version: 'v4', auth: getAuth() });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: `${HOJA}!A1:C${MAX_FILAS}`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    return briefsDesdeGrilla((res.data.values ?? []).map((f) => f.map((c) => String(c ?? ''))));
  } catch (err) {
    if (esHojaInexistente(err)) return [];
    throw err;
  }
}

// ── Escritura ────────────────────────────────────────────────────────────────

type SheetsApi = ReturnType<typeof google.sheets>;

/** Crea la hoja con su encabezado si falta. Idempotente. */
async function asegurarHoja(sheets: SheetsApi, id: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' });
  if (meta.data.sheets?.some((s) => s.properties?.title === HOJA)) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: id,
    requestBody: { requests: [{ addSheet: { properties: { title: HOJA } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${HOJA}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [ENCABEZADO] },
  });
}

/**
 * Guarda el brief en la fila de su fecha (la reemplaza si ya estaba). RAW para
 * que el Sheet no interprete la fecha ni el JSON. Devuelve la fila escrita.
 */
export async function guardarBrief(brief: BriefSemanal, ahora = new Date()): Promise<number> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Falta env var SPREADSHEET_ID');

  const sheets = google.sheets({ version: 'v4', auth: getAuthWrite() });
  await asegurarHoja(sheets, id);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${HOJA}!A1:A${MAX_FILAS}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const columna = (res.data.values ?? []).map((f) => f.map((c) => String(c ?? '')));
  const fila = filaDestino(columna, brief.fecha);

  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${HOJA}!A${fila}:C${fila}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[brief.fecha, serializarParaCelda(brief), ahora.toISOString()]] },
  });
  return fila;
}
