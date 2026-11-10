// Decisión y alternativas descartadas: docs/decisiones/0031-pagos-de-bonos-pasados-desde-la-ficha-y-el-sheet.md
//
// ── Registro de pagos de bonos ──────────────────────────────────────────────
//
// bonistas solo publica los pagos futuros y los últimos 4 de cada bono vivo
// (lib/bonosArg.ts). Para que una renta o amortización cobrada no desaparezca
// del calendario, el job semanal (app/api/alertas/semanal) anota en la hoja
// `PagosBonos` los pagos de los bonos de la cartera que caen cerca de esa
// semana, con el cobro estimado ese día.
//
// La ventana mira hacia atrás y hacia adelante:
// - hacia adelante, porque el último pago de un bono hay que anotarlo ANTES de
//   que ocurra: el día del vencimiento el bono ya no figura en proximos-pagos
//   y su ficha redirige a la home, así que después no queda dónde leerlo.
// - hacia atrás, para cubrir una corrida que haya fallado.
// Ambos márgenes superan los 7 días entre corridas, así que una semana perdida
// no deja huecos.
//
// Solo se agrega, nunca se reescribe: el primer registro de un pago gana. Así
// el monto queda estimado con la tenencia de cuando se cobraba, y una lectura
// fallida no puede vaciar la hoja (ADR 0029): si no se pudo leer lo que ya
// hay, no se escribe nada.
//
// ── Layout de la hoja ───────────────────────────────────────────────────────
//
//        A       B           C       D          E          F            G            H
//   1  TICKER  FECHA       MONEDA  RENTA_100  AMORT_100  COBRO_RENTA  COBRO_AMORT  REGISTRADO
//   2  AL35    2026-07-09  USD     2.06       0          41.2                      2026-07-06
//
// Una fila por pago (ticker + fecha). Los montos `_100` son por 100 nominales;
// COBRO_* es el cobro estimado en MONEDA, vacío si faltaba tenencia o precio.

import { google } from 'googleapis';
import type { DashboardData } from '@/types';
import { getAuth, getAuthWrite, esHojaInexistente } from './sheets';
import { factorNominales, monedaCanonica, pagosDeBonistas, type PagoBono, type PagoRegistrado } from './bonosArg';
import { preciosBonos, preciosBonosArs, mepSpot } from './precios';
import { tickersDeCartera } from './tickersElegibles';

export const HOJA = 'PagosBonos';

const ENCABEZADO = ['TICKER', 'FECHA', 'MONEDA', 'RENTA_100', 'AMORT_100', 'COBRO_RENTA', 'COBRO_AMORT', 'REGISTRADO'];

/** Días hacia atrás que mira cada corrida: cubre una corrida semanal fallida. */
export const DIAS_ATRAS = 14;
/** Días hacia adelante: el último pago de un bono se anota antes de que deje de publicarse. */
export const DIAS_ADELANTE = 10;

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function numero(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Una fila de la hoja → pago registrado, o null si está malformada. */
export function parsearFila(f: unknown[]): PagoRegistrado | null {
  const ticker = String(f[0] ?? '').trim().toUpperCase();
  const fecha = String(f[1] ?? '').trim();
  if (!ticker || !FECHA_RE.test(fecha)) return null;
  const cupon = numero(f[3]) ?? 0;
  const principal = numero(f[4]) ?? 0;
  if (cupon <= 0 && principal <= 0) return null;
  const registrado = String(f[7] ?? '').trim();
  return {
    ticker,
    fecha,
    moneda: monedaCanonica(String(f[2] ?? '')),
    cupon,
    principal,
    cobroRenta: numero(f[5]),
    cobroAmort: numero(f[6]),
    registrado: FECHA_RE.test(registrado) ? registrado : fecha,
  };
}

/** Lee la grilla cruda. null si la hoja todavía no existe. */
async function leerGrilla(): Promise<unknown[][] | null> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Falta env var SPREADSHEET_ID');
  try {
    const sheets = google.sheets({ version: 'v4', auth: getAuth() });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: `${HOJA}!A:H`,
      // Los montos se escriben como números: sin formato vuelven con punto
      // decimal, no con el formato regional del Sheet.
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    return (res.data.values ?? []) as unknown[][];
  } catch (err) {
    if (esHojaInexistente(err)) return null;
    throw err;
  }
}

/** Las filas válidas de la grilla, sin el encabezado. Una fila malformada se omite. */
function registrosDe(grid: unknown[][] | null): PagoRegistrado[] {
  const out: PagoRegistrado[] = [];
  for (const fila of (grid ?? []).slice(1)) {
    const r = parsearFila(fila ?? []);
    if (r) out.push(r);
  }
  return out;
}

/** Pagos registrados. Hoja inexistente = todavía no se registró nada; cualquier otro error falla. */
export async function leerPagosRegistrados(): Promise<PagoRegistrado[]> {
  return registrosDe(await leerGrilla());
}

/** Los pagos que todavía no tienen fila, deduplicados por ticker + fecha. */
export function pagosNuevos(pagos: PagoBono[], existentes: { ticker: string; fecha: string }[]): PagoBono[] {
  const vistas = new Set(existentes.map((e) => `${e.ticker}|${e.fecha}`));
  const out: PagoBono[] = [];
  for (const p of pagos) {
    const k = `${p.ticker}|${p.fecha}`;
    if (vistas.has(k)) continue;
    vistas.add(k);
    out.push(p);
  }
  return out;
}

export function filaDe(r: PagoRegistrado): (string | number)[] {
  return [
    r.ticker, r.fecha, r.moneda, r.cupon, r.principal,
    r.cobroRenta ?? '', r.cobroAmort ?? '', r.registrado,
  ];
}

/**
 * Fecha del registro en hora argentina: el cron corre domingo 21 hs ART, que
 * en UTC ya es lunes. La ventana sigue en UTC, igual que la alerta semanal.
 */
function fechaArgentina(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(d);
}

function sumarDias(fecha: Date, dias: number): string {
  const d = new Date(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export interface ResultadoRegistro {
  registrados: number;
  ventana: { desde: string; hasta: string };
  /** Fuentes de bonistas que fallaron. Si está proximos-pagos, pudo quedar un pago sin anotar. */
  errores: string[];
}

/**
 * Anota en `PagosBonos` los pagos de los bonos de la cartera (último mes de
 * tenencias) en [hoy − DIAS_ATRAS, hoy + DIAS_ADELANTE] que todavía no estén.
 */
export async function registrarPagosBonos(data: DashboardData, ahora = new Date()): Promise<ResultadoRegistro> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Falta env var SPREADSHEET_ID');

  const hoy = ahora.toISOString().slice(0, 10);
  const ventana = { desde: sumarDias(ahora, -DIAS_ATRAS), hasta: sumarDias(ahora, DIAS_ADELANTE) };

  const meses = Object.keys(data.tenenciasPorMes).sort();
  const { tickersArg, tenencias } = tickersDeCartera(data.tenenciasPorMes[meses[meses.length - 1]] ?? []);
  if (tickersArg.length === 0) return { registrados: 0, ventana, errores: [] };

  // Primero lo que ya hay: si esta lectura falla no se escribe nada.
  const grid = await leerGrilla();

  const { pagos, errores } = await pagosDeBonistas(tickersArg, ventana.desde, ventana.hasta, hoy);
  const nuevos = pagosNuevos(pagos, registrosDe(grid));
  if (nuevos.length === 0) return { registrados: 0, ventana, errores };

  const [precios, preciosArs, mep] = await Promise.all([
    preciosBonos(tickersArg),
    preciosBonosArs(tickersArg),
    mepSpot(),
  ]);

  const filas = nuevos.map((p) => {
    const factor = factorNominales(p.ticker, p.moneda, tenencias, precios, preciosArs, mep);
    return filaDe({
      ticker: p.ticker, fecha: p.fecha, moneda: p.moneda, cupon: p.cupon, principal: p.principal,
      cobroRenta: factor != null && p.cupon > 0 ? factor * p.cupon : null,
      cobroAmort: factor != null && p.principal > 0 ? factor * p.principal : null,
      registrado: fechaArgentina(ahora),
    });
  });

  const sheets = google.sheets({ version: 'v4', auth: getAuthWrite() });
  if (grid === null) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: [{ addSheet: { properties: { title: HOJA } } }] },
    });
  }
  const valores = grid === null || grid.length === 0 ? [ENCABEZADO, ...filas] : filas;
  await sheets.spreadsheets.values.append({
    spreadsheetId: id,
    range: `${HOJA}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: valores },
  });

  return { registrados: filas.length, ventana, errores };
}
