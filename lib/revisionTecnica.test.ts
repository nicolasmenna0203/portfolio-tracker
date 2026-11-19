import { describe, it, expect } from 'vitest';
import {
  parsearPrecio,
  parsearNiveles,
  calcularTendencias,
  evaluarActivo,
  revisarNiveles,
  nivelesDesdePayload,
  type NivelTecnico,
  type VelaSemanal,
} from './revisionTecnica';

// Series sintéticas: tickers y precios inventados.
const SEMANA = 7 * 24 * 3600;
const T0 = Date.UTC(2023, 0, 2) / 1000; // un lunes

function velas(cierres: number[], rango = 1): VelaSemanal[] {
  return cierres.map((c, i) => ({ t: T0 + i * SEMANA, high: c + rango, low: c - rango, close: c }));
}

function nivel(n: Partial<NivelTecnico> & { nivel: string; precio: number }): NivelTecnico {
  return { ticker: 'ZZZ', rol: 'SATELITE', lado: n.nivel.startsWith('S') ? 'COMPRA' : 'VENTA', nota: '', ...n };
}

/**
 * Suba con mínimos apoyados exactamente sobre la recta 100 + i: cada 5 semanas
 * el precio baja a tocar la recta y el resto del tiempo está 4 puntos arriba.
 */
function subaSobreRecta(semanas: number): VelaSemanal[] {
  return Array.from({ length: semanas }, (_, i) => {
    const piso = 100 + i;
    const toca = i % 5 === 0;
    const close = toca ? piso + 0.5 : piso + 4;
    return { t: T0 + i * SEMANA, high: close + 1, low: toca ? piso : piso + 3, close };
  });
}

describe('parsearPrecio', () => {
  it('acepta formato argentino, punto decimal y miles', () => {
    expect(parsearPrecio('64,5')).toBe(64.5);
    expect(parsearPrecio('64.5')).toBe(64.5);
    expect(parsearPrecio('1.325')).toBe(1325);
    expect(parsearPrecio('98.000')).toBe(98000);
    expect(parsearPrecio('1.325,50')).toBe(1325.5);
    expect(parsearPrecio('USD 70')).toBe(70);
  });

  it('vacío, texto o no positivo es null', () => {
    expect(parsearPrecio('')).toBeNull();
    expect(parsearPrecio('abc')).toBeNull();
    expect(parsearPrecio('0')).toBeNull();
  });
});

describe('parsearNiveles', () => {
  it('lee las filas válidas y deduce el lado por el nivel', () => {
    const { niveles, avisos } = parsearNiveles([
      { Ticker: 'zzz', Rol: 'satelite', Nivel: 's1', Precio: '64,5', Nota: 'piso' },
      { Ticker: 'ZZZ', Rol: 'SATELITE', Nivel: 'R1', Precio: '73', Nota: '' },
    ]);
    expect(avisos).toEqual([]);
    expect(niveles).toEqual([
      { ticker: 'ZZZ', rol: 'SATELITE', nivel: 'S1', lado: 'COMPRA', precio: 64.5, nota: 'piso' },
      { ticker: 'ZZZ', rol: 'SATELITE', nivel: 'R1', lado: 'VENTA', precio: 73, nota: '' },
    ]);
  });

  it('omite filas inválidas con un aviso que dice la fila, e ignora las vacías', () => {
    const { niveles, avisos } = parsearNiveles([
      { Ticker: 'AAA', Rol: 'OTRO', Nivel: 'S1', Precio: '10' },
      { Ticker: 'BBB', Rol: 'CORE', Nivel: 'X1', Precio: '10' },
      { Ticker: 'CCC', Rol: 'CORE', Nivel: 'S1', Precio: 'n/d' },
      { Ticker: '', Rol: '', Nivel: '', Precio: '' },
    ]);
    expect(niveles).toEqual([]);
    expect(avisos).toHaveLength(3);
    expect(avisos[0]).toContain('fila 2');
    expect(avisos[2]).toContain('fila 4');
  });
});

describe('calcularTendencias', () => {
  it('la alcista se apoya en los mínimos de la suba', () => {
    const serie = subaSobreRecta(60);
    const t = calcularTendencias(serie);
    expect(t.alcista).toBeDefined();
    // La recta es 100 + i: en la última vela (i = 59) vale 159.
    expect(t.alcista!.valor).toBeCloseTo(159, 6);
    expect(t.alcista!.valorPrevio).toBeCloseTo(158, 6);
  });

  it('sin caída de más de 10% desde el máximo no hay bajista', () => {
    expect(calcularTendencias(subaSobreRecta(60)).bajista).toBeUndefined();
  });

  it('una caída con máximos decrecientes tiene bajista con pendiente negativa', () => {
    const sube = Array.from({ length: 30 }, (_, i) => 50 + i * 2); // hasta 108
    const baja = Array.from({ length: 30 }, (_, i) => 108 - i * 1.5 + (i % 6 === 5 ? 6 : 0));
    const t = calcularTendencias(velas([...sube, ...baja]));
    expect(t.bajista).toBeDefined();
    expect(t.bajista!.valor).toBeLessThan(t.bajista!.valorPrevio);
  });

  it('con menos de 20 velas no calcula nada', () => {
    expect(calcularTendencias(velas([10, 11, 12]))).toEqual({});
  });
});

describe('evaluarActivo', () => {
  it('avisa que tocó un nivel de compra viniendo de arriba, con lo que dice el plan', () => {
    const serie = velas([...Array(20).fill(60), 58, 55], 1); // la última vela baja hasta 54
    const e = evaluarActivo('ZZZ', 'SATELITE', [nivel({ nivel: 'S1', precio: 54.5 })], serie)!;
    expect(e.eventos.map((x) => x.tipo)).toEqual(['toco_compra']);
    expect(e.eventos[0].mensaje).toContain('corresponde comprar el tramo');
  });

  it('el mismo nivel tocado en una posición que se vende no sugiere comprar', () => {
    const serie = velas([...Array(20).fill(60), 58, 55], 1);
    const e = evaluarActivo('ZZZ', 'LEGADO', [nivel({ nivel: 'S1', precio: 54.5, rol: 'LEGADO' })], serie)!;
    expect(e.eventos[0].mensaje).toContain('el plan no compra más');
  });

  it('da por perforado un nivel recién con el segundo cierre seguido más de 2% abajo', () => {
    const n = [nivel({ nivel: 'S2', precio: 50 })];
    const unCierre = evaluarActivo('ZZZ', 'SATELITE', n, velas([...Array(20).fill(55), 51, 48], 0.5))!;
    expect(unCierre.eventos.map((x) => x.tipo)).not.toContain('perforo_compra');
    const dosCierres = evaluarActivo('ZZZ', 'SATELITE', n, velas([...Array(20).fill(55), 51, 48, 47], 0.5))!;
    expect(dosCierres.eventos.map((x) => x.tipo)).toContain('perforo_compra');
    // A la semana siguiente ya no se repite: avisa una vez.
    const tercera = evaluarActivo('ZZZ', 'SATELITE', n, velas([...Array(20).fill(55), 51, 48, 47, 46], 0.5))!;
    expect(tercera.eventos.map((x) => x.tipo)).not.toContain('perforo_compra');
  });

  it('avisa que llegó a un nivel de venta viniendo de abajo', () => {
    const serie = velas([...Array(20).fill(60), 62, 66], 1);
    const e = evaluarActivo('ZZZ', 'LEGADO', [nivel({ nivel: 'R1', precio: 66.5, rol: 'LEGADO' })], serie)!;
    expect(e.eventos.map((x) => x.tipo)).toEqual(['toco_venta']);
    expect(e.eventos[0].mensaje).toContain('zona de venta');
  });

  it('detecta el cierre que corta la tendencia alcista', () => {
    const serie = subaSobreRecta(60);
    // Última vela: cierra 3 puntos debajo de la recta (159), sin perforar el mínimo de la ventana.
    serie[59] = { t: serie[59].t, high: 162, low: 155, close: 156 };
    const e = evaluarActivo('ZZZ', 'CORE', [], serie)!;
    expect(e.tendencia).toBe('rota');
    expect(e.eventos.map((x) => x.tipo)).toEqual(['rompio_alcista']);
  });

  it('informa el nivel de compra y de venta más cercanos con su distancia', () => {
    const e = evaluarActivo('ZZZ', 'SATELITE', [
      nivel({ nivel: 'S1', precio: 50 }),
      nivel({ nivel: 'S2', precio: 40 }),
      nivel({ nivel: 'R1', precio: 66 }),
    ], velas([...Array(22).fill(55)]))!;
    expect(e.compraCercana).toEqual({ nivel: 'S1', precio: 50, distancia: 50 / 55 - 1 });
    expect(e.ventaCercana).toEqual({ nivel: 'R1', precio: 66, distancia: 66 / 55 - 1 });
  });
});

describe('revisarNiveles', () => {
  it('agrupa por ticker, ordena por rol y reporta las series que fallan sin cortar el resto', async () => {
    const niveles = [
      nivel({ ticker: 'BBB', rol: 'RADAR', nivel: 'S1', precio: 40 }),
      nivel({ ticker: 'AAA', rol: 'CORE', nivel: 'S1', precio: 40 }),
      nivel({ ticker: 'CCC', rol: 'SATELITE', nivel: 'S1', precio: 40 }),
    ];
    const r = await revisarNiveles(niveles, ['aviso previo'], async (t) => {
      if (t === 'CCC') throw new Error('HTTP 404');
      return velas(Array(25).fill(50));
    });
    expect(r.activos.map((a) => a.ticker)).toEqual(['AAA', 'BBB']);
    expect(r.avisos).toEqual(['aviso previo', 'CCC: HTTP 404']);
  });
});

describe('nivelesDesdePayload', () => {
  it('acepta precios numéricos y en texto, y avisa las filas inválidas', () => {
    const r = nivelesDesdePayload([
      { Ticker: 'AAA', Rol: 'CORE', Nivel: 'S1', Precio: 145 },
      { ticker: 'AAA', rol: 'CORE', nivel: 'R1', precio: '163,5' },
      { Ticker: 'BBB', Rol: 'CORE', Nivel: 'S1', Precio: null },
      'basura',
    ])!;
    expect(r.niveles.map((n) => `${n.nivel}:${n.precio}`)).toEqual(['S1:145', 'R1:163.5']);
    expect(r.avisos).toHaveLength(1);
  });

  it('si no es un array, no hay niveles en el payload', () => {
    expect(nivelesDesdePayload(null)).toBeNull();
    expect(nivelesDesdePayload({})).toBeNull();
  });
});
