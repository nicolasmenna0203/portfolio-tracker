import { describe, it, expect } from 'vitest';
import {
  serieFlujoMensual, resumenFlujo, totalGastos, gastoMensualEn,
  tasaCartera, ratioParaLinea,
} from './finanzasPersonales';
import type { IngresosPorMes, MovimientoRow, GastoFijo, ResumenRow } from '@/types';

// Fixtures sintéticos: montos y fechas ficticios.

const HOY = Date.UTC(2026, 5, 15); // 15/jun/2026 → junio es el mes en curso

function mes(mesKey: string, totalArs: number, totalUsd: number): IngresosPorMes {
  return { mesKey, fecha: mesKey, totalArs, totalUsd, rows: [] };
}

function mov(fecha: number, usd: number, ars: number, clasificacion: 'externo' | 'interno' = 'externo'): MovimientoRow {
  return {
    fecha, monto_usd: Math.abs(usd), monto_ars: Math.abs(ars),
    tipo: usd >= 0 ? 'ingreso' : 'salida',
    monto_neto: usd, monto_neto_ars: ars, clasificacion,
  };
}

const gasto = (over: Partial<GastoFijo>): GastoFijo => ({
  nombre: 'X', monto: 100, moneda: 'ARS', frecuencia: 'mensual', categoria: 'Y', ...over,
});

describe('totalGastos / gastoMensualEn', () => {
  it('prorratea los anuales y convierte con el MEP', () => {
    const gastos = [
      gasto({ monto: 12_000, moneda: 'ARS' }),                    // 12.000 ARS/mes
      gasto({ monto: 120, moneda: 'USD', frecuencia: 'anual' }),  // 10 USD/mes
    ];
    expect(totalGastos(gastos, 'ARS', 1000)).toEqual({ total: 22_000, incompleto: false });
    expect(totalGastos(gastos, 'USD', 1000)).toEqual({ total: 22, incompleto: false });
  });

  it('marca incompleto en vez de sumar 0 en silencio cuando falta el MEP', () => {
    const gastos = [gasto({ monto: 5_000, moneda: 'ARS' }), gasto({ monto: 10, moneda: 'USD' })];
    expect(totalGastos(gastos, 'USD', null)).toEqual({ total: 10, incompleto: true });
  });

  it('no convierte con un MEP inválido', () => {
    expect(gastoMensualEn(gasto({ moneda: 'ARS' }), 'USD', 0)).toBeNull();
  });
});

describe('serieFlujoMensual', () => {
  const ingresos = [mes('2026-04', 1_000_000, 1000), mes('2026-05', 1_000_000, 1000), mes('2026-06', 500_000, 500)];

  it('suma solo aportes externos del mes y calcula la tasa', () => {
    const movs = [
      mov(Date.UTC(2026, 3, 10), 200, 200_000),
      mov(Date.UTC(2026, 3, 20), 100, 100_000),
      mov(Date.UTC(2026, 3, 25), 999, 999_000, 'interno'), // traspaso: no es plata nueva
      mov(Date.UTC(2026, 4, 5), -50, -50_000),             // retiro resta
    ];
    const s = serieFlujoMensual(ingresos, movs, 'USD', HOY);
    expect(s[0].aporte).toBe(300);
    expect(s[0].ratioInversionPct).toBeCloseTo(30);
    expect(s[1].aporte).toBe(-50);
    expect(s[1].ratioInversionPct).toBeCloseTo(-5);
  });

  it('usa la moneda pedida', () => {
    const s = serieFlujoMensual(ingresos, [mov(Date.UTC(2026, 3, 10), 100, 120_000)], 'ARS', HOY);
    expect(s[0].ingreso).toBe(1_000_000);
    expect(s[0].aporte).toBe(120_000);
  });

  it('marca como no cerrado solo el mes en curso', () => {
    const s = serieFlujoMensual(ingresos, [], 'USD', HOY);
    expect(s.map((m) => m.cerrado)).toEqual([true, true, false]);
  });

  it('tasa null si el ingreso del mes es 0', () => {
    const s = serieFlujoMensual([mes('2026-04', 0, 0)], [], 'USD', HOY);
    expect(s[0].ratioInversionPct).toBeNull();
  });
});

describe('ratioParaLinea', () => {
  const mesCon = (ingreso: number, aporte: number) =>
    serieFlujoMensual([mes('2026-04', 0, ingreso)], aporte === 0 ? [] : [mov(Date.UTC(2026, 3, 10), aporte, 0)], 'USD', HOY)[0];

  it('devuelve el ratio de un mes normal', () => {
    expect(ratioParaLinea(mesCon(1000, 250))).toBeCloseTo(25);
    expect(ratioParaLinea(mesCon(1000, 0))).toBe(0);
  });
  it('descarta el mes atípico: aporte mayor al ingreso', () => {
    expect(ratioParaLinea(mesCon(1000, 5000))).toBeNull();
  });
  it('descarta el retiro neto', () => {
    expect(ratioParaLinea(mesCon(1000, -200))).toBeNull();
  });
  it('acepta el borde del 100%', () => {
    expect(ratioParaLinea(mesCon(1000, 1000))).toBeCloseTo(100);
  });
  it('null si no hay ingreso', () => {
    expect(ratioParaLinea(mesCon(0, 100))).toBeNull();
  });
});

describe('resumenFlujo', () => {
  const gastos = [gasto({ monto: 100_000, moneda: 'ARS' })]; // 100 USD a MEP 1000

  it('promedia solo meses cerrados con ingreso y descompone el flujo', () => {
    const serie = serieFlujoMensual(
      [mes('2026-04', 0, 1000), mes('2026-05', 0, 1000), mes('2026-06', 0, 100)],
      [mov(Date.UTC(2026, 3, 10), 200, 0), mov(Date.UTC(2026, 4, 10), 300, 0)],
      'USD', HOY,
    );
    const r = resumenFlujo(serie, gastos, 'USD', 1000);
    expect(r.mesesBase).toBe(2); // junio queda afuera
    expect(r.ingresoProm).toBe(1000);
    expect(r.aporteProm).toBe(250);
    expect(r.ratioInversionPct).toBeCloseTo(25);
    expect(r.gastos).toBeCloseTo(100);
    expect(r.gastosPct).toBeCloseTo(10);
    expect(r.sinAsignar).toBeCloseTo(650);
    // gastos + sin asignar + aporte = ingreso
    expect(r.gastos + r.sinAsignar! + r.aporteProm!).toBeCloseTo(r.ingresoProm!);
  });

  it('la tasa es cociente de sumas: un mes atípico no domina', () => {
    // Mes chico con tasa 100% (100/100) y mes grande con tasa 0% (0/1900):
    // el promedio de tasas daría 50%, el cociente de sumas 100/2000 = 5%.
    const serie = serieFlujoMensual(
      [mes('2026-03', 0, 100), mes('2026-04', 0, 1900)],
      [mov(Date.UTC(2026, 2, 10), 100, 0)],
      'USD', HOY,
    );
    expect(resumenFlujo(serie, [], 'USD', null).ratioInversionPct).toBeCloseTo(5);
  });

  it('sin asignar puede dar negativo si el aporte superó el ingreso', () => {
    const serie = serieFlujoMensual([mes('2026-04', 0, 1000)], [mov(Date.UTC(2026, 3, 10), 1500, 0)], 'USD', HOY);
    expect(resumenFlujo(serie, [], 'USD', null).sinAsignar).toBeLessThan(0);
  });

  it('sin ingresos cargados devuelve nulls pero conserva los gastos', () => {
    const r = resumenFlujo([], gastos, 'ARS', 1000);
    expect(r.mesesBase).toBe(0);
    expect(r.ratioInversionPct).toBeNull();
    expect(r.gastos).toBe(100_000);
  });

  it('si no hay ningún mes cerrado usa el que haya', () => {
    const serie = serieFlujoMensual([mes('2026-06', 0, 800)], [], 'USD', HOY);
    expect(resumenFlujo(serie, [], 'USD', null).ingresoProm).toBe(800);
  });

  it('respeta la ventana', () => {
    const serie = serieFlujoMensual(
      [mes('2026-01', 0, 100), mes('2026-02', 0, 100), mes('2026-03', 0, 300), mes('2026-04', 0, 300)],
      [], 'USD', HOY,
    );
    expect(resumenFlujo(serie, [], 'USD', null, 2).ingresoProm).toBe(300);
  });
});

describe('tasaCartera', () => {
  /** Serie de n+1 meses (base + n) con crecimiento mensual fijo y sin flujos. */
  function serie(n: number, crecMensual: number): ResumenRow[] {
    const filas: ResumenRow[] = [];
    let total = 1000;
    for (let i = 0; i <= n; i++) {
      const fechaTs = Date.UTC(2024, i, 1);
      filas.push({
        fecha: `m${i}`, fechaTs, aportes: 0, aportes_ars: 0, acumulado: 0, acumulado_ars: 0,
        total_cartera: total, total_cartera_ars: total * 1000, rendimiento: 0,
        twrIndiceUsd: 100, twrIndiceArs: 100,
      });
      total *= 1 + crecMensual;
    }
    return filas;
  }

  it('sin flujos, 1% mensual anualiza a ~12,7%', () => {
    const t = tasaCartera(serie(12, 0.01), [], '12m');
    expect(t).not.toBeNull();
    expect(t!.twrAnualPct).toBeCloseTo(12.68, 0);
    expect(t!.meses).toBe(12);
  });

  it('una serie más larga que 12 meses mide solo los últimos 12 en la ventana 12m', () => {
    const filas = serie(24, 0.01);
    // los primeros 12 meses caen fuerte; los últimos 12 suben 1% mensual
    for (let i = 1; i <= 12; i++) {
      filas[i].total_cartera = 1000 * Math.pow(0.97, i);
      filas[i].total_cartera_ars = filas[i].total_cartera * 1000;
    }
    for (let i = 13; i <= 24; i++) {
      filas[i].total_cartera = filas[12].total_cartera * Math.pow(1.01, i - 12);
      filas[i].total_cartera_ars = filas[i].total_cartera * 1000;
    }
    const reciente = tasaCartera(filas, [], '12m')!;
    const total = tasaCartera(filas, [], 'max')!;
    expect(reciente.twrAnualPct).toBeCloseTo(12.68, 0);
    expect(total.twrAnualPct).toBeLessThan(reciente.twrAnualPct);
  });

  it('un aporte no se cuenta como rendimiento', () => {
    // 1000 → 2000 sin mercado: el salto del cierre de marzo es todo un aporte de 1000 en marzo
    const filas = serie(3, 0);
    filas[2].total_cartera = 2000;
    filas[3].total_cartera = 2000;
    const flujo = mov(Date.UTC(2024, 2, 10), 1000, 1_000_000);
    const t = tasaCartera(filas, [flujo], 'max')!;
    expect(Math.abs(t.twrAnualPct)).toBeLessThan(1);
  });

  it('null con menos de dos puntos', () => {
    expect(tasaCartera(serie(0, 0), [], 'max')).toBeNull();
  });
});
