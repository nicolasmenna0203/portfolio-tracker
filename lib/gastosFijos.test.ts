import { describe, it, expect } from 'vitest';
import { normalizarGastos, montoMensual, parsearMes } from './gastosFijos';

describe('parsearMes', () => {
  it('acepta YYYY-MM tal cual', () => {
    expect(parsearMes('2026-03')).toBe('2026-03');
  });

  it('acepta las formas que devuelve Sheets si la celda se convirtió en fecha', () => {
    expect(parsearMes('2026-03-01')).toBe('2026-03');
    expect(parsearMes('01/03/2026')).toBe('2026-03');
    expect(parsearMes('1/3/2026')).toBe('2026-03');
    expect(parsearMes('3/2026')).toBe('2026-03');
  });

  it('descarta lo que no entiende en vez de inventar un mes', () => {
    expect(parsearMes('')).toBeUndefined();
    expect(parsearMes(undefined)).toBeUndefined();
    expect(parsearMes('marzo')).toBeUndefined();
    expect(parsearMes('2026-13')).toBeUndefined();
    expect(parsearMes('01/13/2026')).toBeUndefined();
  });
});

describe('normalizarGastos · vigencia', () => {
  const base = { nombre: 'Gimnasio', monto: 100, moneda: 'ARS', frecuencia: 'mensual', categoria: 'Deportes' };

  it('conserva desde y hasta válidos', () => {
    const [g] = normalizarGastos([{ ...base, desde: '2026-01', hasta: '2026-06' }]);
    expect(g.desde).toBe('2026-01');
    expect(g.hasta).toBe('2026-06');
  });

  it('sin vigencia no agrega las claves (cuenta desde siempre)', () => {
    const [g] = normalizarGastos([base]);
    expect('desde' in g).toBe(false);
    expect('hasta' in g).toBe(false);
  });

  it('ignora meses con formato inválido', () => {
    const [g] = normalizarGastos([{ ...base, desde: 'enero', hasta: '2026-6' }]);
    expect(g.desde).toBeUndefined();
    expect(g.hasta).toBeUndefined();
  });

  it('descarta una baja anterior al inicio', () => {
    const [g] = normalizarGastos([{ ...base, desde: '2026-06', hasta: '2026-01' }]);
    expect(g.desde).toBe('2026-06');
    expect(g.hasta).toBeUndefined();
  });

  it('acepta desde igual a hasta (un solo mes)', () => {
    const [g] = normalizarGastos([{ ...base, desde: '2026-06', hasta: '2026-06' }]);
    expect(g.hasta).toBe('2026-06');
  });
});

describe('normalizarGastos', () => {
  it('conserva gastos válidos', () => {
    const r = normalizarGastos([
      { nombre: 'Claude', monto: 20, moneda: 'USD', frecuencia: 'mensual', categoria: 'Ocio y personal' },
    ]);
    expect(r).toEqual([
      { nombre: 'Claude', monto: 20, moneda: 'USD', frecuencia: 'mensual', categoria: 'Ocio y personal' },
    ]);
  });

  it('descarta entradas sin nombre', () => {
    const r = normalizarGastos([{ nombre: '', monto: 100, moneda: 'ARS', frecuencia: 'mensual', categoria: 'X' }]);
    expect(r).toEqual([]);
  });

  it.each([-1, 0, NaN, Infinity])('descarta monto inválido %s', (monto) => {
    const r = normalizarGastos([{ nombre: 'Algo', monto, moneda: 'ARS', frecuencia: 'mensual', categoria: 'X' }]);
    expect(r).toEqual([]);
  });

  it('convierte monto string a número', () => {
    const r = normalizarGastos([{ nombre: 'Seguro', monto: '45000', moneda: 'ARS', frecuencia: 'mensual', categoria: 'Seguros' }]);
    expect(r[0].monto).toBe(45000);
  });

  it('cae a ARS si la moneda no es USD', () => {
    const r = normalizarGastos([{ nombre: 'X', monto: 10, moneda: 'inventada', frecuencia: 'mensual', categoria: 'Y' }]);
    expect(r[0].moneda).toBe('ARS');
  });

  it('cae a mensual si la frecuencia es inválida', () => {
    const r = normalizarGastos([{ nombre: 'X', monto: 10, moneda: 'ARS', frecuencia: 'semanal', categoria: 'Y' }]);
    expect(r[0].frecuencia).toBe('mensual');
  });

  it('usa "Sin categoría" si no viene categoría', () => {
    const r = normalizarGastos([{ nombre: 'X', monto: 10, moneda: 'ARS', frecuencia: 'mensual', categoria: '' }]);
    expect(r[0].categoria).toBe('Sin categoría');
  });

  it('devuelve vacío si el input no es un array', () => {
    expect(normalizarGastos(null)).toEqual([]);
    expect(normalizarGastos({})).toEqual([]);
    expect(normalizarGastos('x')).toEqual([]);
  });
});

describe('montoMensual', () => {
  it('devuelve el monto tal cual si la frecuencia es mensual', () => {
    expect(montoMensual({ nombre: 'X', monto: 100, moneda: 'ARS', frecuencia: 'mensual', categoria: 'Y' })).toBe(100);
  });

  it('prorratea /12 si la frecuencia es anual', () => {
    expect(montoMensual({ nombre: 'X', monto: 1200, moneda: 'ARS', frecuencia: 'anual', categoria: 'Y' })).toBe(100);
  });
});
