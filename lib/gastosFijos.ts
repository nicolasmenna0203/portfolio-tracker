// ── Gastos (catálogo mensual) ───────────────────────────────────────────────
//
// Catálogo, no serie histórica: a diferencia de Ingresos (una fila por
// acreditación con fecha), acá cada fila es un gasto vigente (recurrente como
// una suscripción o un seguro, o estimado por mes como el supermercado) sin
// fecha de movimiento. La pestaña se llama "Gastos"; el nombre de este módulo,
// de la hoja `GastosFijos` y de la ruta `/api/gastos-fijos` quedó del origen
// (solo recurrentes) y se mantiene para no huérfanar el Sheet existente. El total
// mensual se deriva convirtiendo los anuales a su equivalente /12.
//
// Cada fila tiene una vigencia en meses: `Desde` y `Hasta` ("YYYY-MM",
// inclusivos, ambos opcionales). Vacío en `Desde` = cuenta desde siempre, que es
// lo que significaban las filas cargadas antes de existir esas columnas.
// Decisión y alternativas: docs/decisiones/0025-gastos-con-vigencia-por-mes.md
//
// Vive en la hoja `GastosFijos` del Sheet, con el mismo esquema de
// lectura/escritura que Objetivos (lib/objetivos.ts): GET arma la lista, POST
// reemplaza todo el contenido (overwrite completo, no merge).

import { google } from 'googleapis';
import { readSheet, esHojaInexistente, getAuthWrite } from './sheets';
import { parseArgNum } from './parser';
import type { GastoFijo, FrecuenciaGasto } from '@/types';
import { esMesKey } from './finanzasPersonales';
import { CATEGORIA_SIN } from './gastosCategorias';

export const HOJA = 'GastosFijos';
const ENCABEZADO = ['Nombre', 'Monto', 'Moneda', 'Frecuencia', 'Categoria', 'Desde', 'Hasta'];
const ULTIMA_COLUMNA = 'G';

const FRECUENCIAS: FrecuenciaGasto[] = ['mensual', 'anual'];

function esFrecuencia(v: string): v is FrecuenciaGasto {
  return (FRECUENCIAS as string[]).includes(v);
}

/**
 * Lee un mes de una celda. Se guarda como "YYYY-MM", pero si alguien lo edita a
 * mano en el Sheet, Google lo convierte en fecha y `FORMATTED_VALUE` lo devuelve
 * como "01/10/2026" (DD/MM/YYYY) o "10/2026". Se aceptan las tres formas; lo que
 * no se entiende se descarta (queda sin vigencia, no se inventa un mes).
 */
export function parsearMes(raw: string | undefined): string | undefined {
  const v = (raw ?? '').trim();
  if (!v) return undefined;
  if (esMesKey(v)) return v;

  // Cada patrón captura (año, mes) en su orden propio.
  const formas: [RegExp, (m: RegExpExecArray) => [string, string]][] = [
    [/^(\d{4})-(\d{2})-\d{2}$/, (m) => [m[1], m[2]]],        // YYYY-MM-DD
    [/^\d{1,2}\/(\d{1,2})\/(\d{4})$/, (m) => [m[2], m[1]]],  // DD/MM/YYYY
    [/^(\d{1,2})\/(\d{4})$/, (m) => [m[2], m[1]]],           // MM/YYYY
  ];
  for (const [re, extraer] of formas) {
    const m = re.exec(v);
    if (!m) continue;
    const [anio, mes] = extraer(m);
    const key = `${anio}-${mes.padStart(2, '0')}`;
    return esMesKey(key) ? key : undefined;
  }
  return undefined;
}

/** Descarta una vigencia incoherente (`hasta` antes que `desde`): mejor sin baja que con una baja imposible. */
function vigenciaCoherente(desde: string | undefined, hasta: string | undefined): { desde?: string; hasta?: string } {
  const out: { desde?: string; hasta?: string } = {};
  if (desde) out.desde = desde;
  if (hasta && (!desde || hasta >= desde)) out.hasta = hasta;
  return out;
}

// ── Lectura ──────────────────────────────────────────────────────────────────

/**
 * Solo una hoja que todavía no existe equivale a "sin gastos". Cualquier otro error
 * (red, cuota, credenciales) tiene que fallar: como el guardado reemplaza la lista
 * entera, una lectura fallida tomada como lista vacía borraría el catálogo con el
 * próximo guardado (ADR 0029).
 */
export async function leerGastosFijos(): Promise<GastoFijo[]> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Falta env var SPREADSHEET_ID');

  let rows: Record<string, string>[];
  try {
    rows = await readSheet(id, `${HOJA}!A:${ULTIMA_COLUMNA}`);
  } catch (err) {
    if (esHojaInexistente(err)) return [];
    throw err;
  }

  const gastos: GastoFijo[] = [];
  for (const r of rows) {
    const nombre = (r['Nombre'] ?? r['NOMBRE'] ?? '').trim();
    const monto = parseArgNum(r['Monto'] ?? r['MONTO']);
    const monedaRaw = (r['Moneda'] ?? r['MONEDA'] ?? '').trim().toUpperCase();
    const frecuenciaRaw = (r['Frecuencia'] ?? r['FRECUENCIA'] ?? '').trim().toLowerCase();
    const categoria = (r['Categoria'] ?? r['CATEGORIA'] ?? r['Categoría'] ?? '').trim();

    if (!nombre || monto == null) continue;
    const moneda = monedaRaw === 'USD' ? 'USD' : 'ARS';
    const frecuencia = esFrecuencia(frecuenciaRaw) ? frecuenciaRaw : 'mensual';

    const vigencia = vigenciaCoherente(
      parsearMes(r['Desde'] ?? r['DESDE']),
      parsearMes(r['Hasta'] ?? r['HASTA']),
    );

    gastos.push({ nombre, monto, moneda, frecuencia, categoria: categoria || CATEGORIA_SIN, ...vigencia });
  }

  return gastos;
}

// ── Escritura ────────────────────────────────────────────────────────────────

type SheetsApi = ReturnType<typeof google.sheets>;

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
 * Reemplaza todos los gastos fijos por los recibidos. Overwrite completo, no
 * merge: la UI siempre manda la lista entera, igual que en Objetivos.
 *
 * Primero escribe y después limpia lo que sobra por debajo. El orden inverso
 * (limpiar y escribir) deja la hoja vacía si el segundo paso falla, y con un
 * overwrite completo eso es perder todo el catálogo por un error de red.
 */
export async function guardarGastosFijos(gastos: GastoFijo[]): Promise<number> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Falta env var SPREADSHEET_ID');

  const sheets = google.sheets({ version: 'v4', auth: getAuthWrite() });
  await asegurarHoja(sheets, id);

  const grid: string[][] = [
    ENCABEZADO,
    ...gastos.map((g) => [
      g.nombre, String(g.monto), g.moneda, g.frecuencia, g.categoria, g.desde ?? '', g.hasta ?? '',
    ]),
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${HOJA}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: grid },
  });
  // Sin tope de filas: lo que quede debajo de la última escrita es de una lista más larga.
  await sheets.spreadsheets.values.clear({
    spreadsheetId: id,
    range: `${HOJA}!A${grid.length + 1}:${ULTIMA_COLUMNA}`,
  });

  return gastos.length;
}

/** Normaliza el body entrante al shape esperado, descartando filas inválidas. */
export function normalizarGastos(input: unknown): GastoFijo[] {
  if (!Array.isArray(input)) return [];

  const out: GastoFijo[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const g = item as Record<string, unknown>;
    const nombre = String(g.nombre ?? '').trim();
    const monto = typeof g.monto === 'number' ? g.monto : Number(g.monto);
    if (!nombre || !Number.isFinite(monto) || monto <= 0) continue;

    const moneda = g.moneda === 'USD' ? 'USD' : 'ARS';
    const frecuenciaRaw = String(g.frecuencia ?? '').trim().toLowerCase();
    const frecuencia = esFrecuencia(frecuenciaRaw) ? frecuenciaRaw : 'mensual';
    const categoria = String(g.categoria ?? '').trim() || CATEGORIA_SIN;
    const vigencia = vigenciaCoherente(
      esMesKey(g.desde) ? g.desde : undefined,
      esMesKey(g.hasta) ? g.hasta : undefined,
    );

    out.push({ nombre, monto, moneda, frecuencia, categoria, ...vigencia });
  }
  return out;
}

// El cálculo vive en finanzasPersonales.ts (módulo puro, importable desde el
// cliente); este archivo trae googleapis y no puede ir al bundle del browser.
export { montoMensual } from './finanzasPersonales';
