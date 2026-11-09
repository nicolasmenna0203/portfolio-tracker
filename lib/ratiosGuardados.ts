// Decisión y alternativas descartadas: docs/decisiones/0018-ratios-alineados-por-fecha-e-indicadores-en-el-cliente.md
//
// ── Pares de ratio guardados ────────────────────────────────────────────────
//
// Los pares A/B que el usuario decidió seguir, con su configuración de
// análisis (rango, medias móviles, bandas). Viven en la hoja `Ratios` del
// Sheet por el mismo motivo que los objetivos de composición
// (docs/decisiones/0017): en localStorage solo existirían en el navegador que
// los cargó y el servidor MCP no podría leerlos, así que el asesor no sabría
// qué pares se están siguiendo ni por qué.
//
// ── Layout de la hoja ───────────────────────────────────────────────────────
//
//        A       B      C      D       E     F     G          H
//   1  ACTIVO_A ACTIVO_B RANGO NOTA   SMA1  SMA2  BOLLINGER  CREADO
//   2  AAPL     KO       1a    ...    20    50    SI         2026-01-15
//
// Una fila por par, no bloques como en Objetivos: acá las filas son
// homogéneas (todos los pares tienen los mismos campos) y la cantidad crece
// con el uso, así que la lista larga es la forma natural.
//
// El overwrite es completo, igual que en objetivos: la UI manda siempre la
// lista entera y un merge dejaría colgados los pares eliminados.

import { google } from 'googleapis';
import { getAuth, getAuthWrite, esHojaInexistente } from './sheets';
import type { RangoHistorico } from '@/types';

export const HOJA = 'Ratios';

const RANGOS: readonly RangoHistorico[] = ['1m', '6m', '1a', '5a', '10a'];

export function esRango(v: string): v is RangoHistorico {
  return (RANGOS as readonly string[]).includes(v);
}

/** Un par guardado, con la configuración con la que se lo mira. */
export interface RatioGuardado {
  activoA: string;
  activoB: string;
  rango: RangoHistorico;
  /** Por qué el par importa. Es lo que el asesor lee para dar contexto. */
  nota: string;
  /** Períodos de las dos medias móviles. 0 = desactivada. */
  sma1: number;
  sma2: number;
  bollinger: boolean;
  /** "YYYY-MM-DD". Se conserva entre guardados para no perder la antigüedad. */
  creado: string;
}

const ENCABEZADO = ['ACTIVO_A', 'ACTIVO_B', 'RANGO', 'NOTA', 'SMA1', 'SMA2', 'BOLLINGER', 'CREADO'];

/** Períodos de media móvil admitidos: enteros, y un techo que evita una ventana más larga que cualquier serie. */
const MAX_PERIODO = 400;

function parseEntero(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n < 0 || n > MAX_PERIODO) return 0;
  return Math.floor(n);
}

/**
 * Normaliza un ticker: mayúsculas y sin espacios. Se permiten letras, dígitos y
 * los separadores que usan los símbolos de Yahoo (`^GSPC`, `GC=F`, `BTC-USD`,
 * `BRK.B`); cualquier otra cosa se rechaza para que no llegue a la URL del
 * fetch ni a la hoja.
 */
export function normalizarTicker(raw: unknown): string | null {
  const t = String(raw ?? '').trim().toUpperCase();
  if (!t || t.length > 20) return null;
  return /^[A-Z0-9.\-=^]+$/.test(t) ? t : null;
}

/** Descarta cualquier entrada malformada en vez de dejarla llegar al Sheet. */
export function normalizarRatio(input: unknown): RatioGuardado | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;

  const activoA = normalizarTicker(o.activoA);
  const activoB = normalizarTicker(o.activoB);
  if (!activoA || !activoB) return null;
  // Un par contra sí mismo es la constante 1: no es un error de datos pero no
  // tiene nada que analizar, así que no se guarda.
  if (activoA === activoB) return null;

  const rangoRaw = String(o.rango ?? '').trim();
  const rango: RangoHistorico = esRango(rangoRaw) ? rangoRaw : '1a';

  const creadoRaw = String(o.creado ?? '').trim();
  const creado = /^\d{4}-\d{2}-\d{2}$/.test(creadoRaw)
    ? creadoRaw
    : new Date().toISOString().slice(0, 10);

  return {
    activoA,
    activoB,
    rango,
    nota: String(o.nota ?? '').trim().slice(0, 200),
    sma1: parseEntero(o.sma1),
    sma2: parseEntero(o.sma2),
    bollinger: o.bollinger === true || String(o.bollinger ?? '').trim().toUpperCase() === 'SI',
    creado,
  };
}

/**
 * Normaliza la lista entera y deduplica por par A/B: guardar dos veces el mismo
 * par solo genera dos filas que se pisan conceptualmente. Gana la última, que
 * es la que el usuario acaba de editar.
 */
export function normalizarLista(input: unknown): RatioGuardado[] {
  if (!Array.isArray(input)) return [];

  const porClave = new Map<string, RatioGuardado>();
  for (const item of input) {
    const r = normalizarRatio(item);
    if (r) porClave.set(`${r.activoA}/${r.activoB}`, r);
  }
  return [...porClave.values()];
}

// ── Lectura ──────────────────────────────────────────────────────────────────

/**
 * Lee los pares guardados. Si la hoja todavía no existe devuelve lista vacía en
 * vez de fallar: es el estado normal antes del primer guardado. Cualquier otro
 * error falla: como el guardado reemplaza la lista entera, tomarlo como lista
 * vacía borraría los pares con el próximo guardado (ADR 0029).
 */
export async function leerRatios(): Promise<RatioGuardado[]> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Falta env var SPREADSHEET_ID');

  let grid: string[][];
  try {
    const sheets = google.sheets({ version: 'v4', auth: getAuth() });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: `${HOJA}!A1:H500`,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    grid = (res.data.values ?? []) as string[][];
  } catch (err) {
    if (esHojaInexistente(err)) return [];
    throw err;
  }

  const out: RatioGuardado[] = [];
  for (let i = 1; i < grid.length; i++) {
    const f = grid[i] ?? [];
    const r = normalizarRatio({
      activoA: f[0], activoB: f[1], rango: f[2], nota: f[3],
      sma1: f[4], sma2: f[5], bollinger: f[6], creado: f[7],
    });
    if (r) out.push(r);
  }
  return out;
}

// ── Escritura ────────────────────────────────────────────────────────────────

type SheetsApi = ReturnType<typeof google.sheets>;

/** Crea la hoja si falta. Idempotente. */
async function asegurarHoja(sheets: SheetsApi, id: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  if (meta.data.sheets?.some((s) => s.properties?.title === HOJA)) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: id,
    requestBody: { requests: [{ addSheet: { properties: { title: HOJA } } }] },
  });
}

export function construirGrilla(ratios: RatioGuardado[]): string[][] {
  const grid: string[][] = [ENCABEZADO];
  for (const r of ratios) {
    grid.push([
      r.activoA, r.activoB, r.rango, r.nota,
      String(r.sma1), String(r.sma2), r.bollinger ? 'SI' : 'NO', r.creado,
    ]);
  }
  return grid;
}

/**
 * Reemplaza la lista completa de pares guardados. Devuelve cuántos quedaron.
 * Primero escribe y después limpia lo que sobra por debajo: al revés, un error en
 * el segundo paso deja la hoja vacía (ADR 0029).
 */
export async function guardarRatios(ratios: RatioGuardado[]): Promise<number> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Falta env var SPREADSHEET_ID');

  const sheets = google.sheets({ version: 'v4', auth: getAuthWrite() });
  await asegurarHoja(sheets, id);

  const grid = construirGrilla(ratios);
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${HOJA}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: grid },
  });
  await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: `${HOJA}!A${grid.length + 1}:H500` });

  return ratios.length;
}
