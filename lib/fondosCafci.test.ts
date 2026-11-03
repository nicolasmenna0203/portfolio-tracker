import { describe, it, expect } from 'vitest';
import { parsearFondos } from './fondosCafci';

describe('parsearFondos', () => {
  it('arma los fondos por ticker con sus opcionales', () => {
    const fondos = parsearFondos([
      { TICKER: 'FDOSEIS', NOMBRE_CAFCI: 'Fondo Demo Seis - Clase A', RENTA_VARIABLE: 'NO', CATEGORIA_HISTORICO: 'rentaFija' },
      { TICKER: 'FDOSIETE', NOMBRE_CAFCI: 'Fondo Demo Cinco - Clase A', RENTA_VARIABLE: 'SI', CATEGORIA_HISTORICO: '' },
    ]);
    expect(fondos).toEqual({
      FDOSEIS: { nombre: 'Fondo Demo Seis - Clase A', rentaVariable: false, categoriaHistorico: 'rentaFija' },
      FDOSIETE: { nombre: 'Fondo Demo Cinco - Clase A', rentaVariable: true },
    });
  });

  it('normaliza mayúsculas y espacios de lo que se edita a mano', () => {
    const fondos = parsearFondos([{ TICKER: ' fdosiete ', NOMBRE_CAFCI: ' Fondo Demo ', RENTA_VARIABLE: ' si ' }]);
    expect(fondos).toEqual({ FDOSIETE: { nombre: 'Fondo Demo', rentaVariable: true } });
  });

  it('ignora filas sin ticker o sin nombre', () => {
    expect(parsearFondos([
      { TICKER: '', NOMBRE_CAFCI: 'Sin ticker' },
      { TICKER: 'FDOX', NOMBRE_CAFCI: '' },
    ])).toEqual({});
  });
});
