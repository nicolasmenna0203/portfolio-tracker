import { describe, it, expect } from 'vitest';
import { normalizar, esDimension, DIMENSIONES, construirGrilla } from './objetivos';

describe('esDimension', () => {
  it('acepta las cinco dimensiones válidas', () => {
    for (const d of DIMENSIONES) expect(esDimension(d)).toBe(true);
  });

  it('rechaza cualquier otra cosa', () => {
    expect(esDimension('SECTOR')).toBe(false);
    expect(esDimension('tipo')).toBe(false); // se espera ya normalizado a mayúsculas
    expect(esDimension('')).toBe(false);
  });
});

describe('normalizar', () => {
  it('conserva las dimensiones y categorías válidas', () => {
    const r = normalizar({ TIPO: { ETF: 40, FCI: 60 } });
    expect(r.TIPO).toEqual({ ETF: 40, FCI: 60 });
  });

  it('acepta dimensiones en minúscula y las normaliza', () => {
    const r = normalizar({ tipo: { ETF: 25 } });
    expect(r.TIPO).toEqual({ ETF: 25 });
  });

  it('devuelve las cinco dimensiones aunque el input traiga una sola', () => {
    const r = normalizar({ TIPO: { ETF: 10 } });
    expect(Object.keys(r).sort()).toEqual([...DIMENSIONES].sort());
    expect(r.RIESGO).toEqual({});
  });

  it('descarta dimensiones desconocidas', () => {
    const r = normalizar({ INVENTADA: { X: 50 }, TIPO: { ETF: 50 } });
    expect(r).not.toHaveProperty('INVENTADA');
    expect(r.TIPO).toEqual({ ETF: 50 });
  });

  // El rango importa: un porcentaje fuera de 0-100 llegaría al Sheet y de ahí
  // al cálculo de desvío del asesor.
  it.each([-1, 101, NaN, Infinity])('descarta el porcentaje inválido %s', (val) => {
    const r = normalizar({ TIPO: { ETF: val, FCI: 30 } });
    expect(r.TIPO).toEqual({ FCI: 30 });
  });

  it('convierte strings numéricos', () => {
    const r = normalizar({ TIPO: { ETF: '40' } });
    expect(r.TIPO).toEqual({ ETF: 40 });
  });

  it('descarta valores no numéricos', () => {
    const r = normalizar({ TIPO: { ETF: 'mucho', FCI: 20 } });
    expect(r.TIPO).toEqual({ FCI: 20 });
  });

  it('acepta 0 y 100 como extremos válidos', () => {
    const r = normalizar({ TIPO: { A: 0, B: 100 } });
    expect(r.TIPO).toEqual({ A: 0, B: 100 });
  });

  it('recorta espacios del nombre de categoría y descarta las vacías', () => {
    const r = normalizar({ TIPO: { '  ETF  ': 40, '   ': 10 } });
    expect(r.TIPO).toEqual({ ETF: 40 });
  });

  it.each([null, undefined, 'texto', 42, []])('tolera el input inválido %s', (input) => {
    const r = normalizar(input);
    expect(Object.keys(r).sort()).toEqual([...DIMENSIONES].sort());
    expect(r.TIPO).toEqual({});
  });

  it('ignora una dimensión cuyo valor no es un objeto', () => {
    const r = normalizar({ TIPO: 'no es un objeto', RIESGO: { Alto: 30 } });
    expect(r.TIPO).toEqual({});
    expect(r.RIESGO).toEqual({ Alto: 30 });
  });

  // No se valida que sumen 100: la UI permite guardar un set incompleto
  // mientras se está ajustando, y forzarlo perdería el trabajo en curso.
  it('no exige que los porcentajes sumen 100', () => {
    const r = normalizar({ TIPO: { ETF: 10, FCI: 20 } });
    expect(r.TIPO).toEqual({ ETF: 10, FCI: 20 });
  });
});

describe('construirGrilla', () => {
  const base = normalizar({
    TIPO: { FCI: 25, ACCION: 15, ETF: 30, ALTS: 10, ARGY: 20 },
    RENTA: { FIJA: 68, VARIABLE: 32 },
  });

  it('pone cada dimensión en su propio par de columnas, separadas por una vacía', () => {
    const g = construirGrilla(base);
    // TIPO en A/B, RIESGO en D/E, MONEDA en G/H, RENTA en J/K, GEOGRAFIA en M/N.
    expect(g[0][0]).toBe('TIPO');
    expect(g[0][1]).toBe('%');
    expect(g[0][2]).toBe('');
    expect(g[0][3]).toBe('RIESGO');
    expect(g[0][9]).toBe('RENTA');
    expect(g[0][12]).toBe('GEOGRAFIA');
  });

  it('ordena las categorías alfabéticamente para que la hoja no cambie entre guardados', () => {
    const g = construirGrilla(base);
    const categorias = g.slice(1).map((f) => f[0]).filter((c) => c && c !== 'TOTAL');
    expect(categorias).toEqual(['ACCION', 'ALTS', 'ARGY', 'ETF', 'FCI']);
  });

  it('escribe el porcentaje junto a su categoría', () => {
    const g = construirGrilla(base);
    const fila = g.find((f) => f[0] === 'ETF');
    expect(fila?.[1]).toBe('30');
  });

  it('cierra cada bloque cargado con su TOTAL', () => {
    const g = construirGrilla(base);
    const totales = g[g.length - 1];
    expect(totales[0]).toBe('TOTAL');
    expect(totales[1]).toBe('100');
    // RENTA también suma 100, en su propio par de columnas.
    expect(totales[9]).toBe('TOTAL');
    expect(totales[10]).toBe('100');
  });

  it('no pone TOTAL bajo una dimensión sin objetivos', () => {
    const g = construirGrilla(base);
    const totales = g[g.length - 1];
    expect(totales[3]).toBe(''); // RIESGO está vacío
  });

  it('deja celdas vacías donde un bloque tiene menos categorías que el más largo', () => {
    const g = construirGrilla(base);
    // RENTA tiene 2 categorías y TIPO tiene 5: la fila 3 (índice 3) ya no tiene RENTA.
    expect(g[3][0]).toBeTruthy();
    expect(g[3][9]).toBe('');
  });

  it('con todo vacío devuelve solo el encabezado, sin fila TOTAL', () => {
    const g = construirGrilla(normalizar({}));
    expect(g).toHaveLength(1);
    expect(g[0][0]).toBe('TIPO');
  });

  it('el total refleja una asignación incompleta en vez de forzar 100', () => {
    const g = construirGrilla(normalizar({ TIPO: { ETF: 40, FCI: 30 } }));
    expect(g[g.length - 1][1]).toBe('70');
  });
});
