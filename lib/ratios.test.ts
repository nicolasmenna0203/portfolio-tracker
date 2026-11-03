import { describe, it, expect } from 'vitest';
import {
  serieRatio, sma, ema, bollinger, retornos,
  correlacion, beta, correlacionMovil, estadisticas,
} from './ratios';
import type { PrecioHistoricoPunto } from '@/types';

const p = (fecha: string, close: number): PrecioHistoricoPunto => ({ fecha, close });

describe('serieRatio', () => {
  it('divide precio de A por precio de B en cada fecha', () => {
    const a = [p('2026-01-01', 100), p('2026-01-02', 110)];
    const b = [p('2026-01-01', 50), p('2026-01-02', 55)];
    expect(serieRatio(a, b).map((x) => x.ratio)).toEqual([2, 2]);
  });

  it('conserva los precios que originaron cada punto', () => {
    const r = serieRatio([p('2026-01-01', 100)], [p('2026-01-01', 40)]);
    expect(r[0]).toEqual({ fecha: '2026-01-01', ratio: 2.5, pxA: 100, pxB: 40 });
  });

  // El caso que motiva alinear por fecha: si se apareara por índice, el
  // 02 de A quedaría contra el 03 de B y toda la serie se correría un día.
  it('alinea por fecha, no por posición, cuando a una serie le falta un día', () => {
    const a = [p('2026-01-01', 100), p('2026-01-02', 200), p('2026-01-03', 300)];
    const b = [p('2026-01-01', 10), p('2026-01-03', 30)];
    expect(serieRatio(a, b)).toEqual([
      { fecha: '2026-01-01', ratio: 10, pxA: 100, pxB: 10 },
      { fecha: '2026-01-03', ratio: 10, pxA: 300, pxB: 30 },
    ]);
  });

  it('descarta las fechas que no están en ambas series', () => {
    const a = [p('2026-01-01', 100), p('2026-01-02', 100)];
    const b = [p('2026-01-02', 50), p('2026-01-05', 50)];
    expect(serieRatio(a, b).map((x) => x.fecha)).toEqual(['2026-01-02']);
  });

  it('descarta precios no positivos en vez de producir Infinity o cero', () => {
    const a = [p('2026-01-01', 100), p('2026-01-02', 0)];
    const b = [p('2026-01-01', 0), p('2026-01-02', 50)];
    expect(serieRatio(a, b)).toEqual([]);
  });

  it('ordena por fecha ascendente aunque la entrada venga desordenada', () => {
    const a = [p('2026-01-03', 300), p('2026-01-01', 100)];
    const b = [p('2026-01-01', 10), p('2026-01-03', 10)];
    expect(serieRatio(a, b).map((x) => x.fecha)).toEqual(['2026-01-01', '2026-01-03']);
  });

  it('devuelve vacío si no hay fechas en común', () => {
    expect(serieRatio([p('2026-01-01', 1)], [p('2026-02-01', 1)])).toEqual([]);
  });
});

describe('sma', () => {
  it('promedia la ventana pedida', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  // Un promedio parcial daría una línea que arranca pegada al precio y
  // converge: un artefacto que se lee como señal.
  it('deja null los puntos sin ventana completa', () => {
    expect(sma([10, 20], 5)).toEqual([null, null]);
  });

  it('con periodo 1 devuelve la serie tal cual', () => {
    expect(sma([3, 7, 2], 1)).toEqual([3, 7, 2]);
  });

  it('devuelve todo null con periodo inválido', () => {
    expect(sma([1, 2, 3], 0)).toEqual([null, null, null]);
  });
});

describe('ema', () => {
  it('siembra con la SMA del primer bloque completo', () => {
    // Los primeros 3 valores promedian 2, que es donde arranca la EMA.
    expect(ema([1, 2, 3, 4], 3)?.[2]).toBe(2);
  });

  it('aplica el factor 2/(periodo+1) a partir del sembrado', () => {
    const r = ema([1, 2, 3, 4], 3);
    // k = 0.5 → 4 * 0.5 + 2 * 0.5 = 3
    expect(r[3]).toBe(3);
  });

  it('deja null hasta tener el primer bloque completo', () => {
    expect(ema([1, 2, 3, 4], 3).slice(0, 2)).toEqual([null, null]);
  });

  it('devuelve todo null si la serie es más corta que el periodo', () => {
    expect(ema([1, 2], 5)).toEqual([null, null]);
  });

  it('sobre una serie constante se mantiene en ese valor', () => {
    expect(ema([5, 5, 5, 5], 2)).toEqual([null, 5, 5, 5]);
  });
});

describe('bollinger', () => {
  it('centra las bandas en la SMA', () => {
    const r = bollinger([1, 2, 3, 4, 5], 3);
    expect(r.media).toEqual([null, null, 2, 3, 4]);
  });

  // Desvío poblacional (n), no muestral (n-1): es lo que replican las
  // plataformas y hace que los toques de banda coincidan.
  it('usa desvío poblacional', () => {
    const r = bollinger([1, 2, 3], 3, 1);
    // media 2, varianza poblacional = (1+0+1)/3 = 0.6667, sd ≈ 0.8165
    expect(r.superior[2]).toBeCloseTo(2.8165, 4);
    expect(r.inferior[2]).toBeCloseTo(1.1835, 4);
  });

  it('sobre una serie constante colapsa las bandas en la media', () => {
    const r = bollinger([7, 7, 7], 3);
    expect(r.superior[2]).toBe(7);
    expect(r.inferior[2]).toBe(7);
  });

  it('respeta la cantidad de desvíos pedida', () => {
    const dos = bollinger([1, 2, 3], 3, 2);
    const uno = bollinger([1, 2, 3], 3, 1);
    expect(dos.superior[2]! - 2).toBeCloseTo(2 * (uno.superior[2]! - 2), 10);
  });

  it('deja null las bandas donde no hay ventana completa', () => {
    const r = bollinger([1, 2, 3], 3);
    expect(r.superior.slice(0, 2)).toEqual([null, null]);
  });
});

describe('retornos', () => {
  it('calcula la variación punto a punto', () => {
    expect(retornos([100, 110, 99])).toEqual([0.10000000000000009, -0.09999999999999998]);
  });

  it('devuelve una serie con un elemento menos que la de precios', () => {
    expect(retornos([1, 2, 3, 4])).toHaveLength(3);
  });

  it('devuelve vacío con menos de dos precios', () => {
    expect(retornos([100])).toEqual([]);
  });
});

describe('correlacion', () => {
  it('da 1 cuando las series se mueven idénticamente', () => {
    expect(correlacion([0.01, 0.02, 0.03], [0.01, 0.02, 0.03])).toBeCloseTo(1, 10);
  });

  it('da -1 cuando se mueven en espejo', () => {
    expect(correlacion([0.01, 0.02, 0.03], [-0.01, -0.02, -0.03])).toBeCloseTo(-1, 10);
  });

  it('es invariante a la escala', () => {
    const a = [0.01, -0.02, 0.03];
    expect(correlacion(a, a.map((v) => v * 5))).toBeCloseTo(1, 10);
  });

  // null y 0 son afirmaciones distintas: 0 es "se mueven independientemente",
  // null es "no se puede decir".
  it('devuelve null si una serie no tiene varianza', () => {
    expect(correlacion([0.01, 0.01, 0.01], [0.01, 0.02, 0.03])).toBeNull();
  });

  it('devuelve null con menos de dos puntos', () => {
    expect(correlacion([0.01], [0.02])).toBeNull();
  });

  it('usa el largo de la serie más corta', () => {
    expect(correlacion([0.01, 0.02, 0.03], [0.01, 0.02])).toBeCloseTo(1, 10);
  });
});

describe('beta', () => {
  it('da 1 contra sí misma', () => {
    expect(beta([0.01, -0.02, 0.03], [0.01, -0.02, 0.03])).toBeCloseTo(1, 10);
  });

  it('da 2 cuando A amplifica al doble los movimientos de B', () => {
    const b = [0.01, -0.02, 0.03];
    expect(beta(b.map((v) => v * 2), b)).toBeCloseTo(2, 10);
  });

  it('es negativa cuando A se mueve en contra de B', () => {
    const b = [0.01, -0.02, 0.03];
    expect(beta(b.map((v) => -v), b)).toBeCloseTo(-1, 10);
  });

  it('devuelve null si el activo de referencia no se mueve', () => {
    expect(beta([0.01, 0.02, 0.03], [0.01, 0.01, 0.01])).toBeNull();
  });

  it('devuelve null con menos de dos puntos', () => {
    expect(beta([0.01], [0.02])).toBeNull();
  });
});

describe('correlacionMovil', () => {
  it('deja null hasta completar la ventana', () => {
    const r = correlacionMovil([0.01, 0.02, 0.03], [0.01, 0.02, 0.03], 3);
    expect(r.slice(0, 2)).toEqual([null, null]);
    expect(r[2]).toBeCloseTo(1, 10);
  });

  it('devuelve un punto por cada retorno de la serie más corta', () => {
    expect(correlacionMovil([1, 2, 3, 4], [1, 2, 3], 2)).toHaveLength(3);
  });

  it('detecta el cambio de régimen que la correlación única promedia', () => {
    // Primera mitad en fase, segunda en contrafase.
    const a = [0.01, 0.02, 0.01, 0.02];
    const b = [0.01, 0.02, -0.01, -0.02];
    const r = correlacionMovil(a, b, 2);
    expect(r[1]).toBeCloseTo(1, 10);
    expect(r[3]).toBeCloseTo(-1, 10);
  });
});

describe('estadisticas', () => {
  const serie = [
    { fecha: '2026-01-01', ratio: 2, pxA: 100, pxB: 50 },
    { fecha: '2026-01-02', ratio: 4, pxA: 200, pxB: 50 },
    { fecha: '2026-01-03', ratio: 3, pxA: 150, pxB: 50 },
  ];

  it('devuelve null con serie vacía', () => {
    expect(estadisticas([])).toBeNull();
  });

  it('reporta actual, mínimo, máximo y promedio', () => {
    const e = estadisticas(serie)!;
    expect(e.actual).toBe(3);
    expect(e.minimo).toBe(2);
    expect(e.maximo).toBe(4);
    expect(e.promedio).toBe(3);
  });

  it('ubica el ratio actual dentro del rango del período', () => {
    expect(estadisticas(serie)!.percentil).toBeCloseTo(50, 10);
  });

  it('mide la variación entre el primer y el último punto', () => {
    expect(estadisticas(serie)!.variacion).toBeCloseTo(0.5, 10);
  });

  it('deja null el percentil y el z-score si el ratio nunca se movió', () => {
    const plana = [
      { fecha: '2026-01-01', ratio: 2, pxA: 100, pxB: 50 },
      { fecha: '2026-01-02', ratio: 2, pxA: 100, pxB: 50 },
    ];
    const e = estadisticas(plana)!;
    expect(e.percentil).toBeNull();
    expect(e.zScore).toBeNull();
  });

  it('calcula correlación y beta sobre los precios, no sobre el ratio', () => {
    // pxB es constante, así que no hay contra qué correlacionar.
    const e = estadisticas(serie)!;
    expect(e.correlacion).toBeNull();
    expect(e.beta).toBeNull();
  });

  // Los retornos tienen que variar entre sí: si ambos activos suben el mismo
  // porcentaje todos los días, la serie de retornos es constante, no tiene
  // varianza, y la correlación es null por definición (lo cubre el caso de
  // arriba). Acá el par sube 10% y después 20%, manteniendo el ratio en 2.
  it('da correlación 1 y beta 1 cuando ambos activos se mueven igual', () => {
    const par = [
      { fecha: '2026-01-01', ratio: 2, pxA: 100, pxB: 50 },
      { fecha: '2026-01-02', ratio: 2, pxA: 110, pxB: 55 },
      { fecha: '2026-01-03', ratio: 2, pxA: 132, pxB: 66 },
    ];
    const e = estadisticas(par)!;
    expect(e.correlacion).toBeCloseTo(1, 10);
    expect(e.beta).toBeCloseTo(1, 10);
  });
});
