/**
 * Flujo mensual de finanzas personales: cruza Ingresos (acreditaciones del
 * Sheet), Gastos (catálogo mensual cargado a mano) y los aportes reales a la
 * cartera (movimientos externos) para derivar el ratio de inversión y el ingreso que
 * queda sin explicar. Es la capa que une las tres sub-pestañas; los componentes
 * solo muestran lo que sale de acá.
 *
 * Convenciones (todas deliberadas):
 *
 * - **Ratio de inversión = aportes netos a la cartera / ingresos.** Es el ahorro
 *   *revelado*: lo que efectivamente terminó invertido, venga del sueldo o de
 *   otra fuente (venta de un bien): por eso puede superar el 100% en un mes. No
 *   se calcula como
 *   `(ingreso − gastos) / ingreso` porque los gastos del Sheet son un catálogo
 *   de montos mensuales estimados, completo solo si el usuario cargó todo; lo
 *   que falte quedaría contado como ahorro y el ratio saldría inflado.
 * - **Sin asignar = ingreso − aporte − gastos.** Es un residuo, no un dato
 *   cargado: el gasto que no se cargó más cualquier ahorro que no pasó por la
 *   cartera (efectivo, cuenta bancaria). Cuanto más completo el catálogo de
 *   gastos, más chico y más interpretable. Puede dar negativo cuando un aporte
 *   se fondeó con plata que no es sueldo (venta de un bien, por ejemplo).
 * - **Solo meses con ingresos cargados.** Los ingresos vienen de PDFs que se
 *   suben a mano: un mes sin fila es un mes sin cargar, no un mes con ingreso 0.
 *   Sumar aportes de meses sin ingreso conocido inflaría la tasa.
 * - **Solo meses cerrados** para promedios. El mes en curso suele tener el sueldo
 *   sin acreditar, y promediarlo hundiría el ingreso y dispararía la tasa.
 * - **Promedio como cociente de sumas** (Σaporte / Σingreso), no promedio de
 *   tasas mensuales: un mes con un aporte atípico no domina el resultado.
 * - **Gastos con vigencia, no con fecha de movimiento.** Cada gasto tiene un mes
 *   `desde` y, si se dio de baja, un `hasta` (inclusivos). En cada mes de la
 *   ventana cuentan solo los vigentes en ese mes, y el gasto del resumen es el
 *   promedio de esos meses: así un gasto nuevo no reescribe el pasado. Una fila
 *   sin `desde` cuenta desde siempre (las cargadas antes de existir la
 *   vigencia). Un anual se prorratea /12 en cada mes vigente, no se concentra
 *   en el mes de pago. Ver docs/decisiones/0025-gastos-con-vigencia-por-mes.md
 * - **Gastos al MEP actual.** Aun con vigencia el catálogo es una estimación
 *   mensual, no un movimiento con fecha y cotización, así que los de otra
 *   moneda se convierten con el MEP más reciente, no con el de cada mes (ver
 *   ADR 0007 para el caso contrario, donde sí hay fecha de movimiento).
 * - **Tasa de cartera = TWR anualizado en USD**, no la TIR. Ver
 *   docs/decisiones/0023-tasa-de-cartera-para-proyecciones.md
 */

import type { IngresosPorMes, MovimientoRow, GastoFijo, ResumenRow } from '@/types';
import type { Moneda } from './format';
import { toMesKey } from './parser';
import { calcularMetricasPeriodo } from './periodo';

/** Cuántos meses cerrados entran en los promedios. */
export const VENTANA_MESES = 6;

// ── Gastos ───────────────────────────────────────────────────────────────────

/** Equivalente mensual: los gastos anuales se prorratean /12 para que el total sea comparable. */
export function montoMensual(g: GastoFijo): number {
  return g.frecuencia === 'anual' ? g.monto / 12 : g.monto;
}

// ── Vigencia ─────────────────────────────────────────────────────────────────

const MES_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** true si `v` es una clave de mes "YYYY-MM" válida. */
export function esMesKey(v: unknown): v is string {
  return typeof v === 'string' && MES_KEY_RE.test(v);
}

/** Corre una clave "YYYY-MM" `n` meses, hacia adelante o hacia atrás, cruzando años. */
export function sumarMeses(mesKey: string, n: number): string {
  const [y, m] = mesKey.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Mes anterior a una clave "YYYY-MM" (ene → dic del año previo). */
export function mesAnterior(mesKey: string): string {
  return sumarMeses(mesKey, -1);
}

/** Mes siguiente a una clave "YYYY-MM" (dic → ene del año próximo). */
export function mesSiguiente(mesKey: string): string {
  return sumarMeses(mesKey, 1);
}

/**
 * ¿El gasto cuenta en ese mes? `desde` y `hasta` son inclusivos y se comparan
 * como texto ("YYYY-MM" ordena igual que las fechas). Sin `desde` cuenta desde
 * siempre: así las filas cargadas antes de existir la vigencia se comportan
 * como antes (catálogo uniforme sobre todo el historial).
 */
export function gastoVigenteEn(g: GastoFijo, mesKey: string): boolean {
  if (g.desde && mesKey < g.desde) return false;
  if (g.hasta && mesKey > g.hasta) return false;
  return true;
}

export function gastosVigentes(gastos: GastoFijo[], mesKey: string): GastoFijo[] {
  return gastos.filter((g) => gastoVigenteEn(g, mesKey));
}

/** Monto mensualizado de un gasto en la moneda pedida; `null` si falta el MEP para convertirlo. */
export function gastoMensualEn(g: GastoFijo, destino: Moneda, mep: number | null): number | null {
  const mensual = montoMensual(g);
  if (g.moneda === destino) return mensual;
  if (mep == null || mep <= 0) return null;
  return g.moneda === 'ARS' ? mensual / mep : mensual * mep;
}

export interface TotalGastos {
  total: number;
  /** true si algún gasto quedó afuera del total por no poder convertirse (sin MEP). */
  incompleto: boolean;
}

export function totalGastos(gastos: GastoFijo[], destino: Moneda, mep: number | null): TotalGastos {
  let total = 0;
  let incompleto = false;
  for (const g of gastos) {
    const v = gastoMensualEn(g, destino, mep);
    if (v == null) incompleto = true;
    else total += v;
  }
  return { total, incompleto };
}

// ── Serie mensual ingreso vs aporte ──────────────────────────────────────────

export interface MesFlujo {
  mesKey: string;
  fecha: string;
  ingreso: number;
  /** Aportes netos externos del mes (ingresos − retiros). Los traspasos 'interno' no cuentan. */
  aporte: number;
  /** aporte / ingreso × 100; `null` si el ingreso del mes es 0. */
  ratioInversionPct: number | null;
  /** false para el mes calendario en curso. */
  cerrado: boolean;
}

export function serieFlujoMensual(
  ingresosPorMes: IngresosPorMes[],
  movimientos: MovimientoRow[],
  moneda: Moneda,
  hoyTs: number = Date.now(),
): MesFlujo[] {
  const aportesPorMes = new Map<string, number>();
  for (const mv of movimientos) {
    if (mv.clasificacion !== 'externo') continue;
    const k = toMesKey(mv.fecha);
    const monto = moneda === 'ARS' ? mv.monto_neto_ars : mv.monto_neto;
    aportesPorMes.set(k, (aportesPorMes.get(k) ?? 0) + monto);
  }

  const mesActual = toMesKey(hoyTs);
  return ingresosPorMes.map((m) => {
    const ingreso = moneda === 'ARS' ? m.totalArs : m.totalUsd;
    const aporte = aportesPorMes.get(m.mesKey) ?? 0;
    return {
      mesKey: m.mesKey,
      fecha: m.fecha,
      ingreso,
      aporte,
      ratioInversionPct: ingreso > 0 ? (aporte / ingreso) * 100 : null,
      cerrado: m.mesKey < mesActual,
    };
  });
}

/**
 * Ratio mensual apto para graficar como línea: solo si está entre 0 y 100%.
 * Un mes con aporte mayor al ingreso (venta de un bien, por ejemplo) o con
 * retiro neto no es "qué parte del ingreso se invirtió"; dibujarlo estira el
 * eje y aplasta la tendencia de los meses normales. `null` = mes atípico, que
 * el gráfico deja sin punto (el valor real sigue disponible en `MesFlujo`).
 */
export function ratioParaLinea(m: MesFlujo): number | null {
  const r = m.ratioInversionPct;
  return r != null && r >= 0 && r <= 100 ? r : null;
}

// ── Resumen: ingreso → gastos → sin asignar → aporte ─────────────────────────

export interface ResumenFlujo {
  /** Meses efectivamente promediados (0 si no hay ingresos cargados). */
  mesesBase: number;
  ingresoProm: number | null;
  aporteProm: number | null;
  /** Σaporte / Σingreso de la ventana, en %. */
  ratioInversionPct: number | null;
  /** Gasto mensual promedio de la ventana: en cada mes cuentan solo los gastos vigentes en ese mes. */
  gastos: number;
  gastosIncompleto: boolean;
  /** Gastos como % del ingreso promedio. */
  gastosPct: number | null;
  /** Residuo: ingreso − aporte − gastos. Puede ser negativo (ver header). */
  sinAsignar: number | null;
  sinAsignarPct: number | null;
}

export function resumenFlujo(
  serie: MesFlujo[],
  gastos: GastoFijo[],
  moneda: Moneda,
  mep: number | null,
  ventana: number = VENTANA_MESES,
  hoyTs: number = Date.now(),
): ResumenFlujo {
  const conIngreso = serie.filter((m) => m.ingreso > 0);
  const cerrados = conIngreso.filter((m) => m.cerrado);
  // Si todavía no hay ningún mes cerrado con ingresos (arranque), se usa lo que haya.
  const base = (cerrados.length > 0 ? cerrados : conIngreso).slice(-ventana);

  if (base.length === 0) {
    // Sin ventana que promediar, el gasto es el vigente en el mes en curso.
    const hoy = totalGastos(gastosVigentes(gastos, toMesKey(hoyTs)), moneda, mep);
    return {
      mesesBase: 0, ingresoProm: null, aporteProm: null, ratioInversionPct: null,
      gastos: hoy.total, gastosIncompleto: hoy.incompleto,
      gastosPct: null, sinAsignar: null, sinAsignarPct: null,
    };
  }

  // Cada mes de la ventana lleva sus propios gastos: uno dado de alta hace dos
  // meses no existe en los anteriores, y uno dado de baja deja de contar.
  let sumGastos = 0;
  let incompleto = false;
  for (const m of base) {
    const t = totalGastos(gastosVigentes(gastos, m.mesKey), moneda, mep);
    sumGastos += t.total;
    if (t.incompleto) incompleto = true;
  }
  const gastosTotal = sumGastos / base.length;

  const sumIngreso = base.reduce((s, m) => s + m.ingreso, 0);
  const sumAporte = base.reduce((s, m) => s + m.aporte, 0);
  const ingresoProm = sumIngreso / base.length;
  const aporteProm = sumAporte / base.length;
  const sinAsignar = ingresoProm - aporteProm - gastosTotal;

  return {
    mesesBase: base.length,
    ingresoProm,
    aporteProm,
    ratioInversionPct: (sumAporte / sumIngreso) * 100,
    gastos: gastosTotal,
    gastosIncompleto: incompleto,
    gastosPct: (gastosTotal / ingresoProm) * 100,
    sinAsignar,
    sinAsignarPct: (sinAsignar / ingresoProm) * 100,
  };
}

// ── Tasa de cartera para proyecciones ────────────────────────────────────────

export type VentanaTasa = '12m' | 'max';

export interface TasaCartera {
  /** TWR anualizado en USD, en %. */
  twrAnualPct: number;
  /** TIR (XIRR) del mismo tramo, solo como referencia: no se usa para proyectar. */
  tirAnualPct: number | null;
  /** Mes base del tramo (cierre desde el cual se mide). */
  desdeFecha: string;
  /** Meses medidos. Con menos de 12 la anualización extrapola. */
  meses: number;
}

/**
 * Tasa anual observada de la cartera sobre la ventana pedida. `null` si la
 * serie es demasiado corta para anualizar.
 */
export function tasaCartera(
  resumenSeries: ResumenRow[],
  movimientos: MovimientoRow[],
  ventana: VentanaTasa,
): TasaCartera | null {
  const n = resumenSeries.length;
  if (n < 2) return null;
  const m = calcularMetricasPeriodo(resumenSeries, movimientos, ventana);
  if (!m || m.twrAnualizadoPct == null || !Number.isFinite(m.twrAnualizadoPct)) return null;
  return {
    twrAnualPct: m.twrAnualizadoPct,
    tirAnualPct: m.tirAnualPct,
    desdeFecha: m.desdeFecha,
    meses: ventana === '12m' ? Math.min(12, n - 1) : n - 1,
  };
}
