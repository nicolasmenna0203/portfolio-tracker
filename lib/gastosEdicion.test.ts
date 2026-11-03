import { describe, it, expect } from 'vitest';
import {
  editarGasto, darDeBaja, renombrarCategoria, cambiaLoEconomico, agruparPorConcepto, periodosSolapados, cortarSolapados,
} from './gastosEdicion';
import { gastoVigenteEn } from './finanzasPersonales';
import type { GastoFijo } from '@/types';

const g = (over: Partial<GastoFijo> = {}): GastoFijo => ({
  nombre: 'Alquiler', monto: 100, moneda: 'ARS', frecuencia: 'mensual', categoria: 'Vivienda', ...over,
});

describe('editarGasto · en el lugar', () => {
  it('corrige nombre y categoría sin partir la fila', () => {
    const r = editarGasto([g()], 0, { nombre: 'Alquiler depto', categoria: 'Casa' });
    expect(r).toEqual([g({ nombre: 'Alquiler depto', categoria: 'Casa' })]);
  });

  it('un cambio de monto sin "cambioDesde" es una corrección para todos los meses', () => {
    const r = editarGasto([g({ desde: '2026-01' })], 0, { monto: 150 });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ monto: 150, desde: '2026-01' });
  });

  it('devuelve la lista intacta con un índice inexistente', () => {
    const lista = [g()];
    expect(editarGasto(lista, 5, { monto: 1 })).toBe(lista);
  });

  it('null quita desde y hasta; undefined los deja', () => {
    const base = g({ desde: '2026-01', hasta: '2026-06' });
    const sinHasta = editarGasto([base], 0, { hasta: null })[0];
    expect('hasta' in sinHasta).toBe(false);
    expect(sinHasta.desde).toBe('2026-01');
    const sinDesde = editarGasto([base], 0, { desde: null })[0];
    expect('desde' in sinDesde).toBe(false);
    expect(sinDesde.hasta).toBe('2026-06');
  });

  it('no muta la lista original', () => {
    const lista = [g()];
    editarGasto(lista, 0, { monto: 999 });
    expect(lista[0].monto).toBe(100);
  });
});

describe('editarGasto · cambio desde un mes (parte la fila)', () => {
  it('deja el monto viejo hasta el mes anterior y el nuevo desde el cambio', () => {
    const r = editarGasto([g({ desde: '2026-01' })], 0, { monto: 150 }, { cambioDesde: '2026-04' });
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ monto: 100, desde: '2026-01', hasta: '2026-03' });
    expect(r[1]).toMatchObject({ monto: 150, desde: '2026-04' });
    expect('hasta' in r[1]).toBe(false);
  });

  it('cada mes cuenta una sola versión (sin solapamiento ni huecos)', () => {
    const r = editarGasto([g({ desde: '2026-01' })], 0, { monto: 150 }, { cambioDesde: '2026-04' });
    for (const mes of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']) {
      expect(r.filter((x) => gastoVigenteEn(x, mes))).toHaveLength(1);
    }
    expect(r.find((x) => gastoVigenteEn(x, '2026-03'))!.monto).toBe(100);
    expect(r.find((x) => gastoVigenteEn(x, '2026-04'))!.monto).toBe(150);
  });

  it('funciona con una fila sin desde (cuenta desde siempre)', () => {
    const r = editarGasto([g()], 0, { monto: 150 }, { cambioDesde: '2026-04' });
    expect('desde' in r[0]).toBe(false);
    expect(r[0].hasta).toBe('2026-03');
    expect(r[1].desde).toBe('2026-04');
  });

  it('cruza el año al calcular el mes anterior', () => {
    const r = editarGasto([g({ desde: '2025-06' })], 0, { monto: 150 }, { cambioDesde: '2026-01' });
    expect(r[0].hasta).toBe('2025-12');
  });

  it('nombre y categoría quedan iguales en los dos tramos', () => {
    const r = editarGasto([g({ desde: '2026-01' })], 0, { monto: 150, nombre: 'Alquiler nuevo', categoria: 'Casa' }, { cambioDesde: '2026-04' });
    expect(r.map((x) => x.nombre)).toEqual(['Alquiler nuevo', 'Alquiler nuevo']);
    expect(r.map((x) => x.categoria)).toEqual(['Casa', 'Casa']);
  });

  it('conserva la baja en el tramo nuevo', () => {
    const r = editarGasto([g({ desde: '2026-01', hasta: '2026-08' })], 0, { monto: 150 }, { cambioDesde: '2026-04' });
    expect(r[0].hasta).toBe('2026-03');
    expect(r[1].hasta).toBe('2026-08');
  });

  it('mantiene el orden del resto de la lista', () => {
    const lista = [g({ nombre: 'A' }), g({ nombre: 'B', desde: '2026-01' }), g({ nombre: 'C' })];
    const r = editarGasto(lista, 1, { monto: 150 }, { cambioDesde: '2026-04' });
    expect(r.map((x) => x.nombre)).toEqual(['A', 'B', 'B', 'C']);
  });

  it('si el mes cae antes del inicio o después de la baja, es una corrección', () => {
    const antes = editarGasto([g({ desde: '2026-06' })], 0, { monto: 150 }, { cambioDesde: '2026-06' });
    expect(antes).toHaveLength(1); // mismo mes de inicio: no queda un tramo viejo vacío
    const despues = editarGasto([g({ desde: '2026-01', hasta: '2026-03' })], 0, { monto: 150 }, { cambioDesde: '2026-05' });
    expect(despues).toHaveLength(1);
    expect(despues[0].monto).toBe(150);
  });

  it('si no cambia lo económico no parte aunque haya cambioDesde', () => {
    const r = editarGasto([g({ desde: '2026-01' })], 0, { categoria: 'Casa' }, { cambioDesde: '2026-04' });
    expect(r).toHaveLength(1);
  });

  it('la moneda y la frecuencia también cuentan como cambio económico', () => {
    expect(cambiaLoEconomico(g(), { moneda: 'USD' })).toBe(true);
    expect(cambiaLoEconomico(g(), { frecuencia: 'anual' })).toBe(true);
    expect(cambiaLoEconomico(g(), { monto: 100 })).toBe(false); // mismo valor: no es un cambio
  });
});

describe('editarGasto · nombre y categoría son de todo el concepto', () => {
  const periodos = [
    g({ desde: '2026-01', hasta: '2026-03' }),
    g({ nombre: 'Otro gasto' }),
    g({ desde: '2026-04', monto: 150 }),
  ];

  it('cambiar la categoría de un período la cambia en todos, sin tocar montos ni fechas', () => {
    const r = editarGasto(periodos, 2, { categoria: 'Hogar' });
    expect(r[0]).toEqual(g({ desde: '2026-01', hasta: '2026-03', categoria: 'Hogar' }));
    expect(r[2]).toEqual(g({ desde: '2026-04', monto: 150, categoria: 'Hogar' }));
  });

  it('renombrar un período los renombra a todos y no toca a los demás gastos', () => {
    const r = editarGasto(periodos, 0, { nombre: 'Alquiler depto' });
    expect(r.map((x) => x.nombre)).toEqual(['Alquiler depto', 'Otro gasto', 'Alquiler depto']);
    expect(agruparPorConcepto(r, '2026-06')).toHaveLength(2);
  });

  it('también al partir una fila por un cambio desde un mes', () => {
    const r = editarGasto(periodos, 2, { categoria: 'Hogar', monto: 200 }, { cambioDesde: '2026-08' });
    expect(r).toHaveLength(4);
    expect(r.filter((x) => x.nombre === 'Alquiler').map((x) => x.categoria)).toEqual(['Hogar', 'Hogar', 'Hogar']);
    expect(r[3]).toMatchObject({ monto: 200, desde: '2026-08' });
  });
});

describe('cortarSolapados', () => {
  const nuevo = { nombre: 'Alquiler', categoria: 'Vivienda' };

  it('termina el período abierto el mes anterior al nuevo', () => {
    const r = cortarSolapados([g({ desde: '2026-01' })], { ...nuevo, desde: '2026-06', hasta: null });
    expect(r).toEqual([g({ desde: '2026-01', hasta: '2026-05' })]);
  });

  it('corta también un período sin inicio y no toca otros gastos', () => {
    const otro = g({ nombre: 'Otro' });
    const r = cortarSolapados([g(), otro], { ...nuevo, desde: '2026-06' })!;
    expect(r[0].hasta).toBe('2026-05');
    expect(r[1]).toBe(otro);
  });

  it('sin superposición no hay nada que cortar', () => {
    expect(cortarSolapados([g({ hasta: '2026-03' })], { ...nuevo, desde: '2026-06' })).toBeNull();
  });

  it('un período nuevo sin inicio no se puede usar para cortar', () => {
    expect(cortarSolapados([g({ desde: '2026-01' })], { ...nuevo, desde: null })).toBeNull();
  });

  it('no corta si el otro período arranca en el mismo mes o después: quedaría vacío', () => {
    expect(cortarSolapados([g({ desde: '2026-06' })], { ...nuevo, desde: '2026-06' })).toBeNull();
    expect(cortarSolapados([g({ desde: '2026-08' })], { ...nuevo, desde: '2026-06' })).toBeNull();
  });

  it('no corta si el nuevo termina antes: los meses siguientes quedarían sin gasto', () => {
    expect(cortarSolapados([g({ desde: '2026-01' })], { ...nuevo, desde: '2026-06', hasta: '2026-08' })).toBeNull();
    expect(cortarSolapados([g({ desde: '2026-01', hasta: '2026-12' })], { ...nuevo, desde: '2026-06', hasta: '2026-08' })).toBeNull();
  });

  it('corta si el nuevo cubre hasta el fin del otro', () => {
    const r = cortarSolapados([g({ desde: '2026-01', hasta: '2026-08' })], { ...nuevo, desde: '2026-06', hasta: '2026-08' });
    expect(r![0].hasta).toBe('2026-05');
  });
});

describe('darDeBaja', () => {
  it('pone el hasta y conserva el gasto', () => {
    const r = darDeBaja([g({ desde: '2026-01' })], 0, '2026-06');
    expect(r).toEqual([g({ desde: '2026-01', hasta: '2026-06' })]);
  });

  it('si el gasto ni había empezado en ese mes, lo elimina', () => {
    expect(darDeBaja([g({ desde: '2026-09' })], 0, '2026-06')).toEqual([]);
  });

  it('un gasto que arranca justo ese mes se conserva por un mes', () => {
    const r = darDeBaja([g({ desde: '2026-06' })], 0, '2026-06');
    expect(r[0]).toMatchObject({ desde: '2026-06', hasta: '2026-06' });
  });
});

describe('categorías', () => {
  const lista = [g({ categoria: 'Comida' }), g({ categoria: 'comidas' }), g({ categoria: 'Salud' })];

  it('renombra en todos los gastos de la categoría', () => {
    const r = renombrarCategoria(lista, 'Salud', 'Médicos');
    expect(r.map((x) => x.categoria)).toEqual(['Comida', 'comidas', 'Médicos']);
  });

  it('renombrar a una existente las fusiona', () => {
    const r = renombrarCategoria(lista, 'comidas', 'Comida');
    expect(r.map((x) => x.categoria)).toEqual(['Comida', 'Comida', 'Salud']);
  });

  it('un nombre vacío vuelve a "Sin categoría"', () => {
    expect(renombrarCategoria(lista, 'Salud', '  ')[2].categoria).toBe('Sin categoría');
  });
});

describe('agruparPorConcepto', () => {
  const HOY = '2026-11';

  it('un aumento de monto es un solo gasto activo, no una baja más uno nuevo', () => {
    const lista = [
      g({ nombre: 'Nafta', monto: 100, hasta: '2026-10' }),
      g({ nombre: 'Nafta', monto: 80, desde: '2026-11' }),
    ];
    const [c] = agruparPorConcepto(lista, HOY);
    expect(agruparPorConcepto(lista, HOY)).toHaveLength(1);
    expect(c.estado).toBe('activo');
    expect(c.actual.g.monto).toBe(80);
    expect(c.tramos.map((t) => t.idx)).toEqual([0, 1]);
  });

  it('ordena los tramos por inicio y el "desde siempre" va primero', () => {
    const lista = [
      g({ nombre: 'Seguro', desde: '2026-06' }),
      g({ nombre: 'Seguro', hasta: '2026-03' }),
      g({ nombre: 'Seguro', desde: '2026-04', hasta: '2026-05' }),
    ];
    expect(agruparPorConcepto(lista, HOY)[0].tramos.map((t) => t.idx)).toEqual([1, 2, 0]);
  });

  it('con todos los tramos terminados está de baja y muestra el último', () => {
    const lista = [
      g({ nombre: 'Curso', monto: 10, hasta: '2026-03' }),
      g({ nombre: 'Curso', monto: 20, desde: '2026-04', hasta: '2026-08' }),
    ];
    const [c] = agruparPorConcepto(lista, HOY);
    expect(c.estado).toBe('baja');
    expect(c.actual.g.monto).toBe(20);
  });

  it('un gasto que se corta y vuelve queda programado mientras el segundo tramo no empieza', () => {
    const lista = [
      g({ nombre: 'Club', monto: 10, hasta: '2026-09' }),
      g({ nombre: 'Club', monto: 15, desde: '2027-01' }),
    ];
    const [c] = agruparPorConcepto(lista, HOY);
    expect(c.estado).toBe('programado');
    expect(c.actual.g.monto).toBe(15);
  });

  it('el mismo nombre en otra categoría, o con otro nombre, es otro gasto', () => {
    const lista = [
      g({ nombre: 'Gimnasio', categoria: 'Ocio y personal' }),
      g({ nombre: 'gimnasio', categoria: 'Ocio y personal' }),
      g({ nombre: 'Gimnasio', categoria: 'Hogar' }),
      g({ nombre: 'Pileta', categoria: 'Ocio y personal' }),
    ];
    expect(agruparPorConcepto(lista, HOY).map((c) => c.tramos.length)).toEqual([2, 1, 1]);
  });
});

describe('periodosSolapados', () => {
  const lista = [g({ nombre: 'Nafta', desde: '2026-01', hasta: '2026-06' })];
  const cand = (desde: string | null, hasta: string | null, nombre = 'Nafta') =>
    ({ nombre, categoria: 'Vivienda', desde, hasta });

  it('períodos que se tocan en un mes se solapan', () => {
    expect(periodosSolapados(lista, cand('2026-06', null))).toHaveLength(1);
  });

  it('un período que arranca el mes siguiente no se solapa', () => {
    expect(periodosSolapados(lista, cand('2026-07', null))).toEqual([]);
  });

  it('sin fin solapa con todo lo posterior; sin inicio, con todo lo anterior', () => {
    expect(periodosSolapados(lista, cand('2027-01', null))).toEqual([]);
    expect(periodosSolapados(lista, cand(null, '2026-02'))).toHaveLength(1);
    expect(periodosSolapados([g({ nombre: 'Nafta' })], cand('2030-01', null))).toHaveLength(1);
  });

  it('ignora otros gastos y la fila que se está editando', () => {
    expect(periodosSolapados(lista, cand('2026-01', null, 'Uber'))).toEqual([]);
    expect(periodosSolapados(lista, cand('2026-01', null), lista[0])).toEqual([]);
  });
});
