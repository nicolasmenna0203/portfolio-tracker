import { beforeEach, describe, expect, it, vi } from 'vitest';

// Las tres hojas que el dashboard reescribe enteras (gastos, objetivos, ratios)
// comparten dos reglas para no perder datos: una lectura fallida no es una lista
// vacía, y se escribe antes de limpiar. Ver docs/decisiones/0029-*.md
// Google se simula: nada de esto toca un Sheet real.

const api = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  clear: vi.fn(),
  meta: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: class {}, JWT: class {} },
    sheets: () => ({
      spreadsheets: {
        get: api.meta,
        batchUpdate: vi.fn(),
        values: { get: api.get, update: api.update, clear: api.clear },
      },
    }),
  },
}));

import { esHojaInexistente } from './sheets';
import { leerGastosFijos, guardarGastosFijos } from './gastosFijos';
import { leerObjetivos, guardarObjetivos, normalizar } from './objetivos';
import { leerRatios, guardarRatios } from './ratiosGuardados';

const VACIO_OBJETIVOS = { TIPO: {}, RIESGO: {}, MONEDA: {}, RENTA: {}, SECTOR_GEO: {} };

const HOJA_INEXISTENTE = 'Unable to parse range: Hoja!A:G';
const OTROS_ERRORES = ['Quota exceeded for quota metric', 'socket hang up', 'The caller does not have permission'];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SPREADSHEET_ID = 'sheet-de-prueba';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}';
  api.meta.mockResolvedValue({ data: { sheets: [{ properties: { title: 'GastosFijos' } }, { properties: { title: 'Objetivos' } }, { properties: { title: 'Ratios' } }] } });
  api.update.mockResolvedValue({});
  api.clear.mockResolvedValue({});
});

describe('esHojaInexistente', () => {
  it('reconoce la respuesta de Sheets para una hoja que no existe', () => {
    expect(esHojaInexistente(new Error(HOJA_INEXISTENTE))).toBe(true);
  });

  it.each(OTROS_ERRORES)('cualquier otro error no lo es: %s', (msg) => {
    expect(esHojaInexistente(new Error(msg))).toBe(false);
  });

  it('algo que no es un Error no lo es', () => {
    expect(esHojaInexistente('Unable to parse range')).toBe(false);
  });
});

describe.each([
  ['gastos', leerGastosFijos, []],
  ['objetivos', leerObjetivos, VACIO_OBJETIVOS],
  ['ratios', leerRatios, []],
] as const)('lectura de %s', (_nombre, leer, vacio) => {
  it('una hoja que no existe es el estado vacío', async () => {
    api.get.mockRejectedValue(new Error(HOJA_INEXISTENTE));
    await expect(leer()).resolves.toEqual(vacio);
  });

  it.each(OTROS_ERRORES)('otro error falla, no devuelve vacío: %s', async (msg) => {
    api.get.mockRejectedValue(new Error(msg));
    await expect(leer()).rejects.toThrow(msg);
  });
});

const GASTO = { nombre: 'Algo', monto: 100, moneda: 'ARS' as const, frecuencia: 'mensual' as const, categoria: 'Hogar' };
const RATIO = { activoA: 'AAA', activoB: 'BBB', rango: '1a' as const, nota: '', sma1: 20, sma2: 50, bollinger: true, creado: '2026-01-01' };

describe.each([
  ['gastos', () => guardarGastosFijos([GASTO])],
  ['objetivos', () => guardarObjetivos(normalizar({ TIPO: { Acciones: 100 } }))],
  ['ratios', () => guardarRatios([RATIO])],
] as const)('escritura de %s', (_nombre, guardar) => {
  it('escribe antes de limpiar, y limpia solo por debajo de lo escrito', async () => {
    await guardar();
    expect(api.update.mock.invocationCallOrder[0]).toBeLessThan(api.clear.mock.invocationCallOrder[0]);
    const filas = api.update.mock.calls[0][0].requestBody.values.length;
    expect(api.clear.mock.calls[0][0].range).toContain(`!A${filas + 1}:`);
  });

  it('si la escritura falla no limpia nada', async () => {
    api.update.mockRejectedValue(new Error('socket hang up'));
    await expect(guardar()).rejects.toThrow('socket hang up');
    expect(api.clear).not.toHaveBeenCalled();
  });
});

describe('escritura de objetivos · filas completas', () => {
  it('toda fila llega hasta la última columna: la API no toca las celdas que no recibe', async () => {
    await guardarObjetivos(normalizar({ TIPO: { Acciones: 60, Bonos: 40 }, MONEDA: { USD: 100 } }));
    const grid: string[][] = api.update.mock.calls[0][0].requestBody.values;
    expect(grid.every((fila) => fila.length === 26)).toBe(true);
    // La fila en blanco antes del TOTAL también pisa lo que hubiera ahí.
    expect(grid.some((fila) => fila.every((c) => c === ''))).toBe(true);
  });
});
