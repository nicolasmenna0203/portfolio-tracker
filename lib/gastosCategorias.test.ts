import { describe, it, expect } from 'vitest';
import {
  normalizarTexto, sugerirCategoria, gastosParaRecategorizar, esCategoriaDeLista, descripcionCategoria, CATEGORIAS,
} from './gastosCategorias';
import type { GastoFijo } from '@/types';

const g = (nombre: string, categoria: string): GastoFijo => ({
  nombre, monto: 100, moneda: 'ARS', frecuencia: 'mensual', categoria,
});

describe('normalizarTexto', () => {
  it('saca tildes, mayúsculas y puntuación', () => {
    expect(normalizarTexto('  Médico / Odontólogo,  ')).toBe('medico odontologo');
  });
});

describe('CATEGORIAS', () => {
  it('son las cuatro acordadas y no repiten nombres', () => {
    expect(CATEGORIAS).toEqual(['Súper y comida', 'Transporte', 'Hogar', 'Ocio y personal']);
    expect(new Set(CATEGORIAS).size).toBe(CATEGORIAS.length);
  });

  it.each(['Otros', 'Sin categoría', 'Comida', 'Servicios', 'Suscripciones', 'transporte'])('%s no es de la lista', (c) => {
    expect(esCategoriaDeLista(c)).toBe(false);
  });

  it('cada categoría de la lista tiene su descripción; las de afuera no', () => {
    for (const c of CATEGORIAS) expect(descripcionCategoria(c), c).toBeTruthy();
    expect(descripcionCategoria('Otros')).toBeNull();
  });

  it('toda sugerencia del diccionario es una categoría de la lista', () => {
    const nombres = [
      'Alquiler', 'Luz', 'Netflix', 'Supermercado', 'Delivery', 'Nafta', 'Prepaga', 'Seguro auto',
      'Monotributo', 'Colegio', 'Gimnasio', 'Veterinario', 'Vuelo', 'Zapatillas', 'Muebles',
    ];
    for (const n of nombres) {
      expect(CATEGORIAS, n).toContain(sugerirCategoria(n, [])?.categoria);
    }
  });
});

describe('sugerirCategoria · diccionario', () => {
  it.each([
    ['Supermercado', 'Súper y comida'],
    ['Almuerzos', 'Súper y comida'],
    ['Kiosco', 'Súper y comida'],
    ['Artículos de limpieza', 'Súper y comida'],
    ['Perfumería', 'Súper y comida'],
    ['Nafta', 'Transporte'],
    ['Uber', 'Transporte'],
    ['Patente', 'Transporte'],
    ['Alquiler', 'Hogar'],
    ['Expensas', 'Hogar'],
    ['Luz', 'Hogar'],
    ['Internet hogar', 'Hogar'],
    ['Netflix', 'Ocio y personal'],
    ['Apple', 'Ocio y personal'],
    ['Suscripciones varias', 'Ocio y personal'],
    ['Gimnasio', 'Ocio y personal'],
    ['Salidas', 'Ocio y personal'],
    ['Delivery', 'Ocio y personal'],
    ['Prepaga', 'Ocio y personal'],
    ['Monotributo', 'Ocio y personal'],
    ['Colegio', 'Ocio y personal'],
  ])('%s → %s', (nombre, esperada) => {
    const s = sugerirCategoria(nombre, []);
    expect(s?.categoria).toBe(esperada);
    expect(s?.origen).toBe('regla');
  });

  it.each([
    ['Seguro auto', 'Transporte'],
    ['Seguro hogar', 'Hogar'],
    ['Seguro de vida', 'Ocio y personal'],
    ['Seguro médico', 'Ocio y personal'],
  ])('el seguro va según su fin: %s → %s', (nombre, esperada) => {
    expect(sugerirCategoria(nombre, [])?.categoria).toBe(esperada);
  });

  it('las claves cortas no coinciden por prefijo', () => {
    // "gas" no debe agarrar "gastos"; "bar" no debe agarrar "barrio"
    expect(sugerirCategoria('Gastos varios', [])).toBeNull();
    expect(sugerirCategoria('Barrio cerrado', [])).toBeNull();
  });

  it('no opina de un nombre demasiado corto o desconocido', () => {
    expect(sugerirCategoria('ab', [])).toBeNull();
    expect(sugerirCategoria('Cosa rara', [])).toBeNull();
  });
});

describe('sugerirCategoria · historial del usuario', () => {
  it('prefiere la categoría de un gasto parecido ya cargado', () => {
    const s = sugerirCategoria('Clases de zumba', [g('Zumba', 'Hogar')]);
    expect(s).toMatchObject({ categoria: 'Hogar', origen: 'historial' });
  });

  it('un nombre igual a uno existente repite su categoría', () => {
    const s = sugerirCategoria('supermercado', [g('Supermercado', 'Hogar')]);
    expect(s).toMatchObject({ categoria: 'Hogar', origen: 'historial' });
  });

  it('compartir solo "seguro" no hace parecidos a dos gastos', () => {
    const s = sugerirCategoria('Seguro hogar', [g('Seguro auto', 'Transporte')]);
    expect(s).toMatchObject({ categoria: 'Hogar', origen: 'regla' });
  });

  it('una categoría fuera de la lista no enseña nada', () => {
    expect(sugerirCategoria('Zumba', [g('Zumba', 'Otros'), g('Zumba', 'Deportes')])).toBeNull();
  });
});

describe('gastosParaRecategorizar', () => {
  it('propone una categoría de la lista para lo que quedó afuera', () => {
    const r = gastosParaRecategorizar([g('Gimnasio', 'Otros'), g('Cosa rara', 'Sin categoría')]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ indices: [0] });
    expect(r[0].sugerencia.categoria).toBe('Ocio y personal');
  });

  it('manda el nombre del gasto sobre la categoría vieja', () => {
    const r = gastosParaRecategorizar([g('Netflix', 'Servicios')]);
    expect(r[0].sugerencia).toMatchObject({ categoria: 'Ocio y personal', motivo: 'por el nombre' });
  });

  it('lo que estaba en "Suscripciones" pasa a Ocio y personal', () => {
    const r = gastosParaRecategorizar([g('Cosa rara', 'Suscripciones')]);
    expect(r[0].sugerencia).toMatchObject({ categoria: 'Ocio y personal', motivo: 'porque estaba en «Suscripciones»' });
  });

  it('los períodos de un mismo gasto son una sola sugerencia con todos sus índices', () => {
    const r = gastosParaRecategorizar([g('Netflix', 'Servicios'), g('Nafta', 'Transporte'), g('netflix', 'Servicios')]);
    expect(r).toHaveLength(1);
    expect(r[0].indices).toEqual([0, 2]);
  });

  it('el mismo nombre en dos categorías viejas son dos gastos', () => {
    const r = gastosParaRecategorizar([g('Netflix', 'Servicios'), g('Netflix', 'Otros')]);
    expect(r.map((x) => x.indices)).toEqual([[0], [1]]);
  });

  it('si el nombre no dice nada, usa la categoría equivalente', () => {
    const r = gastosParaRecategorizar([g('Cosa rara', 'Comida'), g('Otra cosa', 'comidas')]);
    expect(r.map((x) => x.sugerencia.categoria)).toEqual(['Súper y comida', 'Súper y comida']);
    expect(r[0].sugerencia.motivo).toBe('porque estaba en «Comida»');
  });

  it('una categoría desconocida y un nombre desconocido no sugieren nada', () => {
    expect(gastosParaRecategorizar([g('Cosa rara', 'Inventada')])).toEqual([]);
  });

  it('no toca lo que ya está en la lista, aunque el nombre sugiera otra', () => {
    expect(gastosParaRecategorizar([g('Gimnasio', 'Ocio y personal'), g('Nafta', 'Transporte')])).toEqual([]);
  });
});
