import { describe, it, expect } from 'vitest';
import { calcularMetricasPeriodo } from './periodo';
import { xirr } from './finance';
import type { ResumenRow, MovimientoRow } from '@/types';

function row(y: number, m: number, total: number, totalArs: number): ResumenRow {
  const fechaTs = Date.UTC(y, m - 1, 1);
  return {
    fecha: `${m}-${y}`,
    fechaTs,
    aportes: 0,
    aportes_ars: 0,
    acumulado: 0,
    acumulado_ars: 0,
    total_cartera: total,
    total_cartera_ars: totalArs,
    rendimiento: 0,
    twrIndiceUsd: 100,
    twrIndiceArs: 100,
  };
}

function mov(y: number, m: number, d: number, usd: number, tipo: 'ingreso' | 'salida', clasificacion: 'externo' | 'interno' = 'externo'): MovimientoRow {
  const fecha = Date.UTC(y, m - 1, d);
  const ars = usd * 1000;
  const monto_neto = tipo === 'ingreso' ? usd : -usd;
  return { fecha, monto_usd: usd, monto_ars: ars, tipo, monto_neto, monto_neto_ars: monto_neto * 1000, clasificacion };
}

describe('calcularMetricasPeriodo', () => {
  const resumenSeries: ResumenRow[] = [
    row(2024, 1, 1000, 1_000_000),
    row(2024, 2, 1100, 1_150_000),
    row(2024, 3, 1250, 1_350_000), // con aporte de 100 el día 10
    row(2025, 1, 1500, 1_700_000), // salto de año para probar YTD
  ];
  const movimientos: MovimientoRow[] = [
    mov(2024, 3, 10, 100, 'ingreso'),
  ];

  it('período "max" arranca en el primer mes de la serie', () => {
    const m = calcularMetricasPeriodo(resumenSeries, movimientos, 'max');
    expect(m).not.toBeNull();
    expect(m!.desdeFecha).toBe(resumenSeries[0].fecha);
  });

  it('período "1m" usa el penúltimo mes como base y mide solo el último', () => {
    const m = calcularMetricasPeriodo(resumenSeries, movimientos, '1m');
    expect(m!.desdeFecha).toBe(resumenSeries[2].fecha); // marzo 2024 es la BASE
    // El aporte del 10/3 pertenece al mes base (marzo), cuyo cierre ya lo
    // refleja: no entra en el tramo. Ganancia = 1500 − 1250 = 250.
    expect(m!.gananciaUsd).toBeCloseTo(250, 6);
  });

  it('período "ytd" usa el cierre de diciembre anterior como base, para no comerse enero', () => {
    // Bug real: arrancar en el primer mes DEL año medía desde el cierre de
    // enero, perdiendo el rendimiento de enero entero. La base tiene que ser
    // el último punto del año anterior.
    const m = calcularMetricasPeriodo(resumenSeries, movimientos, 'ytd');
    expect(m!.desdeFecha).toBe(resumenSeries[2].fecha); // mar-2024, último punto de 2024
    // Mide mar-2024 (cierre 1250) -> ene-2025 (1500), sin aportes en el tramo.
    expect(m!.gananciaUsd).toBeCloseTo(250, 6);
  });

  it('los flujos del mes base no entran en el tramo', () => {
    // El cierre del mes base ya incluye sus propios movimientos: contarlos
    // otra vez los duplicaría contra una valuación que ya los tiene adentro.
    const m = calcularMetricasPeriodo(resumenSeries, movimientos, '1m');
    // El único movimiento (10/3/2024) cae en el mes base, así que la ganancia
    // del tramo no lo descuenta.
    expect(m!.gananciaUsd).toBeCloseTo(1500 - 1250, 6);
  });

  it('en "max" la ganancia es valuación − aportes netos, sin restar el valor inicial', () => {
    // Bug real: restar `inicio.total_cartera` ADEMÁS de los aportes descuenta
    // dos veces el primer aporte (el que creó ese valor inicial). Sobre la
    // serie completa la ganancia tiene que coincidir con la definición de
    // kpis.rendimientoNeto: valuación final − aportes netos acumulados.
    const m = calcularMetricasPeriodo(resumenSeries, movimientos, 'max');
    const fin = resumenSeries[resumenSeries.length - 1];
    const aportesNetos = movimientos
      .filter((mv) => mv.clasificacion === 'externo')
      .reduce((s, mv) => s + mv.monto_neto, 0);
    expect(m!.gananciaUsd).toBeCloseTo(fin.total_cartera - aportesNetos, 6);
    expect(m!.gananciaUsd).toBeCloseTo(1500 - 100, 6);
  });

  it('un movimiento clasificado como interno no se resta de la ganancia', () => {
    const movConInterno: MovimientoRow[] = [
      mov(2024, 3, 10, 100, 'ingreso', 'interno'),
    ];
    const m = calcularMetricasPeriodo(resumenSeries, movConInterno, 'max');
    // Sin aportes externos: ganancia = 1500 - 0 = 1500
    expect(m!.gananciaUsd).toBeCloseTo(1500, 6);
  });

  it('devuelve null con una serie vacía', () => {
    expect(calcularMetricasPeriodo([], [], 'max')).toBeNull();
  });

  it('en período "max" la TIR usa los movimientos reales, sin un flujo implícito extra al arranque', () => {
    // Bug real: el tramo "max" arranca en el primer punto de TODA la serie,
    // donde no hay capital previo invisible — los movimientos reales ya
    // explican el 100% del capital. Agregar el valor de cartera al arranque
    // como "aporte implícito" ahí duplica el primer aporte real y rompe la
    // TIR (pasó de 19% a 8,7% con datos reales antes de este fix).
    const m = calcularMetricasPeriodo(resumenSeries, movimientos, 'max');
    const fin = resumenSeries[resumenSeries.length - 1];
    const xirrDirecta = xirr([
      ...movimientos.map((mv) => ({ date: mv.fecha, amount: -mv.monto_neto })),
      { date: Date.now(), amount: fin.total_cartera },
    ]);
    expect(m!.tirAnualPct).toBeCloseTo(xirrDirecta! * 100, 1);
  });

  it('en un período acotado (no "max"), la TIR usa el valor de la base como flujo implícito y solo los flujos posteriores', () => {
    const m = calcularMetricasPeriodo(resumenSeries, movimientos, '1m');
    // El tramo "1m" tiene como base marzo-2024 (índice 2): hace falta el
    // aporte implícito de 1250 (el capital con el que arranca) y SOLO los
    // movimientos del mes siguiente en adelante — los de marzo ya están
    // dentro de ese 1250.
    const base = resumenSeries[2];
    const d0 = new Date(base.fechaTs);
    const desdeTs = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1);
    const movDelTramo = movimientos.filter((mv) => mv.fecha >= desdeTs);
    const xirrConImplicito = xirr([
      { date: base.fechaTs, amount: -base.total_cartera },
      ...movDelTramo.map((mv) => ({ date: mv.fecha, amount: -mv.monto_neto })),
      { date: Date.now(), amount: resumenSeries[resumenSeries.length - 1].total_cartera },
    ]);
    expect(m!.tirAnualPct).toBeCloseTo(xirrConImplicito! * 100, 1);
  });
});
