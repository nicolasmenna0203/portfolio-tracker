import { describe, it, expect } from 'vitest';
import {
  normalizarTicker, normalizarRatio, normalizarLista,
  construirGrilla, esRango,
} from './ratiosGuardados';

describe('esRango', () => {
  it('acepta los cinco rangos válidos', () => {
    for (const r of ['1m', '6m', '1a', '5a', '10a']) expect(esRango(r)).toBe(true);
  });

  it('rechaza cualquier otro', () => {
    expect(esRango('3m')).toBe(false);
    expect(esRango('')).toBe(false);
  });
});

describe('normalizarTicker', () => {
  it('pasa a mayúsculas y recorta espacios', () => {
    expect(normalizarTicker('  aapl ')).toBe('AAPL');
  });

  it('acepta los separadores de los símbolos de Yahoo', () => {
    expect(normalizarTicker('^GSPC')).toBe('^GSPC');
    expect(normalizarTicker('GC=F')).toBe('GC=F');
    expect(normalizarTicker('BTC-USD')).toBe('BTC-USD');
    expect(normalizarTicker('BRK.B')).toBe('BRK.B');
  });

  // Este valor termina en la URL del fetch a Yahoo y en el Sheet.
  it('rechaza caracteres que no son de un símbolo', () => {
    expect(normalizarTicker('AAPL/../etc')).toBeNull();
    expect(normalizarTicker('AAPL KO')).toBeNull();
    expect(normalizarTicker('<script>')).toBeNull();
  });

  it('rechaza vacío y desmesurado', () => {
    expect(normalizarTicker('')).toBeNull();
    expect(normalizarTicker(null)).toBeNull();
    expect(normalizarTicker('A'.repeat(21))).toBeNull();
  });
});

describe('normalizarRatio', () => {
  const base = { activoA: 'AAPL', activoB: 'KO', rango: '1a', creado: '2026-01-15' };

  it('conserva un par válido', () => {
    const r = normalizarRatio({ ...base, nota: 'tecnología vs consumo', sma1: 20, sma2: 50, bollinger: true })!;
    expect(r.activoA).toBe('AAPL');
    expect(r.activoB).toBe('KO');
    expect(r.rango).toBe('1a');
    expect(r.nota).toBe('tecnología vs consumo');
    expect(r.sma1).toBe(20);
    expect(r.bollinger).toBe(true);
  });

  it('rechaza input que no es objeto', () => {
    expect(normalizarRatio(null)).toBeNull();
    expect(normalizarRatio('AAPL/KO')).toBeNull();
  });

  it('rechaza el par si falta una pata', () => {
    expect(normalizarRatio({ activoA: 'AAPL' })).toBeNull();
  });

  // Constante 1: no es dato corrupto, pero no hay nada que analizar.
  it('rechaza un activo contra sí mismo', () => {
    expect(normalizarRatio({ activoA: 'AAPL', activoB: 'aapl' })).toBeNull();
  });

  it('cae en 1a si el rango es inválido', () => {
    expect(normalizarRatio({ ...base, rango: '3m' })!.rango).toBe('1a');
  });

  it('lee el SI/NO con el que se guardó bollinger en el Sheet', () => {
    expect(normalizarRatio({ ...base, bollinger: 'SI' })!.bollinger).toBe(true);
    expect(normalizarRatio({ ...base, bollinger: 'NO' })!.bollinger).toBe(false);
  });

  it('convierte los períodos que el Sheet devuelve como string', () => {
    expect(normalizarRatio({ ...base, sma1: '20' })!.sma1).toBe(20);
  });

  // Una ventana más larga que cualquier serie razonable dejaría la media en
  // null en todos los puntos; 0 es el valor que la UI lee como "desactivada".
  it('descarta períodos fuera de rango o no numéricos', () => {
    expect(normalizarRatio({ ...base, sma1: -5 })!.sma1).toBe(0);
    expect(normalizarRatio({ ...base, sma1: 9999 })!.sma1).toBe(0);
    expect(normalizarRatio({ ...base, sma1: 'mucho' })!.sma1).toBe(0);
  });

  it('trunca el período a entero', () => {
    expect(normalizarRatio({ ...base, sma1: 20.7 })!.sma1).toBe(20);
  });

  it('acota la nota', () => {
    expect(normalizarRatio({ ...base, nota: 'x'.repeat(500) })!.nota).toHaveLength(200);
  });

  it('completa la fecha de creación si falta o es inválida', () => {
    expect(normalizarRatio({ ...base, creado: 'ayer' })!.creado).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(normalizarRatio({ activoA: 'AAPL', activoB: 'KO' })!.creado).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('respeta la fecha de creación existente para no perder antigüedad', () => {
    expect(normalizarRatio(base)!.creado).toBe('2026-01-15');
  });
});

describe('normalizarLista', () => {
  it('devuelve vacío si no es un array', () => {
    expect(normalizarLista(null)).toEqual([]);
    expect(normalizarLista({ activoA: 'AAPL' })).toEqual([]);
  });

  it('descarta las entradas inválidas y conserva las buenas', () => {
    const r = normalizarLista([
      { activoA: 'AAPL', activoB: 'KO' },
      { activoA: 'AAPL' },
      null,
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].activoA).toBe('AAPL');
  });

  it('deduplica el mismo par quedándose con la última edición', () => {
    const r = normalizarLista([
      { activoA: 'AAPL', activoB: 'KO', nota: 'vieja' },
      { activoA: 'aapl', activoB: 'ko', nota: 'nueva' },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].nota).toBe('nueva');
  });

  // A/B y B/A son análisis distintos (el ratio es el recíproco), no duplicados.
  it('no considera duplicado el par invertido', () => {
    const r = normalizarLista([
      { activoA: 'AAPL', activoB: 'KO' },
      { activoA: 'KO', activoB: 'AAPL' },
    ]);
    expect(r).toHaveLength(2);
  });
});

describe('construirGrilla', () => {
  const par = {
    activoA: 'AAPL', activoB: 'KO', rango: '1a' as const,
    nota: 'tecnología vs consumo', sma1: 20, sma2: 50,
    bollinger: true, creado: '2026-01-15',
  };

  it('escribe el encabezado aunque no haya pares', () => {
    const g = construirGrilla([]);
    expect(g).toHaveLength(1);
    expect(g[0][0]).toBe('ACTIVO_A');
  });

  it('escribe una fila por par', () => {
    expect(construirGrilla([par, { ...par, activoB: 'TLT' }])).toHaveLength(3);
  });

  it('serializa el par en el orden del encabezado', () => {
    expect(construirGrilla([par])[1]).toEqual(
      ['AAPL', 'KO', '1a', 'tecnología vs consumo', '20', '50', 'SI', '2026-01-15'],
    );
  });

  // Round-trip: lo que se escribe se tiene que poder releer igual.
  it('produce filas que normalizarRatio vuelve a leer sin pérdida', () => {
    const [, fila] = construirGrilla([par]);
    const releido = normalizarRatio({
      activoA: fila[0], activoB: fila[1], rango: fila[2], nota: fila[3],
      sma1: fila[4], sma2: fila[5], bollinger: fila[6], creado: fila[7],
    });
    expect(releido).toEqual(par);
  });
});
