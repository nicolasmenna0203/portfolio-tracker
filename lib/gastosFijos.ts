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
// Vive en la hoja `GastosFijos` del Sheet, con el mismo esquema de
// lectura/escritura que Objetivos (lib/objetivos.ts): GET arma la lista, POST
// reemplaza todo el contenido (overwrite completo, no merge).

import { google } from 'googleapis';
import { readSheet } from './sheets';
import { parseArgNum } from './parser';
import type { GastoFijo, FrecuenciaGasto } from '@/types';

export const HOJA = 'GastosFijos';

const FRECUENCIAS: FrecuenciaGasto[] = ['mensual', 'anual'];

function esFrecuencia(v: string): v is FrecuenciaGasto {
  return (FRECUENCIAS as string[]).includes(v);
}

// ── Lectura ──────────────────────────────────────────────────────────────────

export async function leerGastosFijos(): Promise<GastoFijo[]> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Falta env var SPREADSHEET_ID');

  let rows: Record<string, string>[];
  try {
    rows = await readSheet(id, `${HOJA}!A:E`);
  } catch {
    return [];
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

    gastos.push({ nombre, monto, moneda, frecuencia, categoria: categoria || 'Sin categoría' });
  }

  return gastos;
}

// ── Escritura ────────────────────────────────────────────────────────────────

function getAuthWrite() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Falta env var GOOGLE_SERVICE_ACCOUNT_JSON');
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

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
 */
export async function guardarGastosFijos(gastos: GastoFijo[]): Promise<number> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Falta env var SPREADSHEET_ID');

  const sheets = google.sheets({ version: 'v4', auth: getAuthWrite() });
  await asegurarHoja(sheets, id);

  const grid: string[][] = [
    ['Nombre', 'Monto', 'Moneda', 'Frecuencia', 'Categoria'],
    ...gastos.map((g) => [g.nombre, String(g.monto), g.moneda, g.frecuencia, g.categoria]),
  ];

  await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: `${HOJA}!A1:E500` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${HOJA}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: grid },
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
    const categoria = String(g.categoria ?? '').trim() || 'Sin categoría';

    out.push({ nombre, monto, moneda, frecuencia, categoria });
  }
  return out;
}

// El cálculo vive en finanzasPersonales.ts (módulo puro, importable desde el
// cliente); este archivo trae googleapis y no puede ir al bundle del browser.
export { montoMensual } from './finanzasPersonales';
