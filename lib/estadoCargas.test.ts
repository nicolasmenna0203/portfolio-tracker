import { describe, expect, it } from 'vitest';
import { armarEstadoCargas, mesEnCurso, proximoMesACargar, ultimoMesCerrado } from './estadoCargas';

describe('proximoMesACargar', () => {
  const ahora = new Date('2026-11-02T12:00:00Z');

  it('propone el mes siguiente al último cargado, aunque vengan desordenados', () => {
    expect(proximoMesACargar(['2026-09', '2026-07', '2026-08'], ahora)).toBe('2026-10');
  });

  it('cruza el año', () => {
    expect(proximoMesACargar(['2025-12'], new Date('2026-03-10T12:00:00Z'))).toBe('2026-01');
  });

  it('no pasa del mes en curso', () => {
    expect(proximoMesACargar(['2026-10'], ahora)).toBe('2026-11');
    expect(proximoMesACargar(['2026-11'], ahora)).toBe('2026-11');
  });

  it('sin nada cargado, propone el último mes cerrado', () => {
    expect(proximoMesACargar([], ahora)).toBe('2026-10');
  });
});

describe('mesEnCurso', () => {
  it('usa la hora de Argentina: la noche del 31 sigue siendo ese mes', () => {
    expect(mesEnCurso(new Date('2026-11-01T01:00:00Z'))).toBe('2026-10');
    expect(mesEnCurso(new Date('2026-11-01T03:00:00Z'))).toBe('2026-11');
  });
});

describe('ultimoMesCerrado', () => {
  it('devuelve el mes anterior al actual', () => {
    expect(ultimoMesCerrado(new Date('2026-11-15T12:00:00Z'))).toBe('2026-10');
  });

  it('cruza el año en enero', () => {
    expect(ultimoMesCerrado(new Date('2027-01-15T12:00:00Z'))).toBe('2026-12');
  });

  it('usa la hora de Argentina: la noche del 31 todavía no cerró el mes', () => {
    // 01:00 UTC del 1/11 son las 22:00 del 31/10 en Argentina.
    expect(ultimoMesCerrado(new Date('2026-11-01T01:00:00Z'))).toBe('2026-09');
    // 03:00 UTC del 1/11 ya es el 1/11 en Argentina.
    expect(ultimoMesCerrado(new Date('2026-11-01T03:00:00Z'))).toBe('2026-10');
  });
});

describe('armarEstadoCargas', () => {
  const ahora = new Date('2026-11-15T12:00:00Z');

  it('marca cargado cada archivo con filas del último mes cerrado', () => {
    expect(armarEstadoCargas({
      tenencias: ['30/09/2026', '31/10/2026'],
      movimientos: ['2026-10-07'],
      haberes: ['03/10/2026'],
    }, ahora)).toEqual({ mes: '2026-10', tenencias: true, movimientos: true, haberes: true });
  });

  it('un archivo con filas solo de otros meses queda pendiente', () => {
    expect(armarEstadoCargas({
      tenencias: ['31/10/2026'],
      movimientos: ['07/09/2026'],
      haberes: ['03/10/2025', '01/11/2026'],
    }, ahora)).toEqual({ mes: '2026-10', tenencias: true, movimientos: false, haberes: false });
  });

  it('una hoja vacía o con fechas ilegibles queda pendiente', () => {
    expect(armarEstadoCargas({
      tenencias: [],
      movimientos: ['sin fecha'],
      haberes: [''],
    }, ahora)).toEqual({ mes: '2026-10', tenencias: false, movimientos: false, haberes: false });
  });
});
