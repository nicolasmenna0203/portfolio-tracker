import { describe, it, expect } from 'vitest';
import { deflactarARS, ultimoMesPublicado, type PuntoIndice } from './inflacion';
import { calcularMetricasPeriodo } from './periodo';
import type { MovimientoRow, ResumenRow } from '@/types';

// Fixtures sintéticos: inflación de 10% mensual, índice base 100 en ene-2024.
const indice10: PuntoIndice[] = [
  { mesKey: '2024-01', valor: 100 },
  { mesKey: '2024-02', valor: 110 },
  { mesKey: '2024-03', valor: 121 },
];

function row(y: number, m: number, totalArs: number): ResumenRow {
  return {
    fecha: `${m}-${y}`,
    fechaTs: Date.UTC(y, m - 1, 1),
    aportes: 0,
    aportes_ars: 0,
    acumulado: 0,
    acumulado_ars: 0,
    total_cartera: 1000,
    total_cartera_ars: totalArs,
    rendimiento: 0,
    twrIndiceUsd: 100,
    twrIndiceArs: 100,
  };
}

function mov(y: number, m: number, d: number, ars: number): MovimientoRow {
  return {
    fecha: Date.UTC(y, m - 1, d),
    monto_usd: ars / 1000,
    monto_ars: ars,
    tipo: 'ingreso',
    monto_neto: ars / 1000,
    monto_neto_ars: ars,
    clasificacion: 'externo',
  };
}

describe('deflactarARS', () => {
  it('una cartera que sube igual que la inflación tiene rendimiento real cero', () => {
    const serie = [row(2024, 1, 1_000_000), row(2024, 2, 1_100_000), row(2024, 3, 1_210_000)];
    const real = deflactarARS(serie, [], indice10)!;
    // Todo expresado en pesos de marzo: las tres valuaciones valen lo mismo.
    expect(real.baseMesKey).toBe('2024-03');
    expect(real.resumenSeries.map((r) => r.total_cartera_ars)).toEqual([
      expect.closeTo(1_210_000, 4), expect.closeTo(1_210_000, 4), expect.closeTo(1_210_000, 4),
    ]);
    const m = calcularMetricasPeriodo(real.resumenSeries, real.movimientos, 'max')!;
    expect(m.twrAcumuladoArsPct).toBeCloseTo(0, 6);
  });

  it('el último mes queda igual (factor 1) y los campos USD no se tocan', () => {
    const serie = [row(2024, 1, 1_000_000), row(2024, 3, 2_000_000)];
    const real = deflactarARS(serie, [], indice10)!;
    expect(real.resumenSeries[1].total_cartera_ars).toBeCloseTo(2_000_000, 6);
    expect(real.resumenSeries.every((r) => r.total_cartera === 1000)).toBe(true);
  });

  it('un flujo a mitad de mes se interpola geométricamente entre los dos cierres', () => {
    // 16/2 en un mes de 29 días: fracción 15/29 entre 100 y 110.
    const nivel = 100 * Math.pow(110 / 100, 15 / 29);
    const serie = [row(2024, 1, 1_000_000), row(2024, 2, 1_100_000), row(2024, 3, 1_210_000)];
    const real = deflactarARS(serie, [mov(2024, 2, 16, 500_000)], indice10)!;
    const esperado = 500_000 * (121 / nivel);
    expect(real.movimientos[0].monto_neto_ars).toBeCloseTo(esperado, 2);
    // acumulado_ars de marzo = ese único flujo deflactado
    expect(real.resumenSeries[2].acumulado_ars).toBeCloseTo(esperado, 2);
    // monto_usd no se toca
    expect(real.movimientos[0].monto_usd).toBe(500);
  });

  it('la TIR real es la nominal descontada la inflación', () => {
    // Un aporte el 1/1 y una cartera que no crece en pesos: nominal ≈ 0%,
    // real muy negativa.
    const serie = [row(2024, 1, 1_000_000), row(2024, 2, 1_000_000), row(2024, 3, 1_000_000)];
    const movs = [mov(2024, 1, 1, 1_000_000)];
    const nominal = calcularMetricasPeriodo(serie, movs, 'max')!;
    const real = deflactarARS(serie, movs, indice10)!;
    const metricasReal = calcularMetricasPeriodo(real.resumenSeries, real.movimientos, 'max')!;
    expect(metricasReal.gananciaArs).toBeLessThan(nominal.gananciaArs);
    expect(metricasReal.twrAcumuladoArsPct!).toBeLessThan(0);
  });

  it('sin índice o sin serie devuelve null', () => {
    expect(deflactarARS([], [], indice10)).toBeNull();
    expect(deflactarARS([row(2024, 1, 1)], [], [])).toBeNull();
  });

  it('meses fuera del índice se acotan al primero/último, sin romper', () => {
    const serie = [row(2023, 12, 1_000_000), row(2024, 5, 1_000_000)];
    const real = deflactarARS(serie, [mov(2023, 12, 20, 100)], indice10)!;
    expect(real.resumenSeries.every((r) => Number.isFinite(r.total_cartera_ars))).toBe(true);
    expect(Number.isFinite(real.movimientos[0].monto_neto_ars)).toBe(true);
  });
});

describe('ultimoMesPublicado', () => {
  it('detecta la cola de meses repetidos como no publicada', () => {
    const conCola: PuntoIndice[] = [
      ...indice10,
      { mesKey: '2024-04', valor: 121 },
      { mesKey: '2024-05', valor: 121 },
    ];
    expect(ultimoMesPublicado(conCola)).toBe('2024-03');
  });

  it('si el último mes es distinto al anterior, ese es el último publicado', () => {
    expect(ultimoMesPublicado(indice10)).toBe('2024-03');
  });

  it('índice vacío → null', () => {
    expect(ultimoMesPublicado([])).toBeNull();
  });
});
