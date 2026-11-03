import { describe, it, expect } from 'vitest';
import { etiquetaCategoria, tenenciasDeDimension, sumarPorCategoria, participacionPorCategoria, SIN_DATO } from './dimensiones';
import type { TenenciaActual } from '@/types';

// Tenencias sintéticas: tickers y montos ficticios.
function item(partial: Partial<TenenciaActual> & { ticker: string }): TenenciaActual {
  return {
    tenencia_ars: 0,
    tenencia_usd: 0,
    fechaTs: 0,
    fechaMes: '2026-07',
    TIPO: 'ETF',
    RIESGO: 2,
    SECTOR_GEO: 'EU',
    RENTA: 'VAR',
    MONEDA: 'USD',
    ...partial,
  };
}

describe('etiquetaCategoria', () => {
  it('traduce los códigos del Sheet a la etiqueta con la que se guardan los objetivos', () => {
    const t = item({ ticker: 'AAA', RIESGO: 4, SECTOR_GEO: 'EMER', RENTA: 'VAR', MONEDA: 'BAD' });
    expect(etiquetaCategoria(t, 'RIESGO')).toBe('AGRESIVO');
    expect(etiquetaCategoria(t, 'SECTOR_GEO')).toBe('EMERGENTES');
    expect(etiquetaCategoria(t, 'RENTA')).toBe('VARIABLE');
    expect(etiquetaCategoria(t, 'MONEDA')).toBe('BADLAR');
    expect(etiquetaCategoria(t, 'TIPO')).toBe('ETF');
  });

  it('deja tal cual un código sin etiqueta', () => {
    expect(etiquetaCategoria(item({ ticker: 'AAA', MONEDA: 'CER' }), 'MONEDA')).toBe('CER');
  });

  it('agrupa los datos faltantes o desconocidos en "Sin dato"', () => {
    expect(etiquetaCategoria(item({ ticker: 'AAA', TIPO: '' }), 'TIPO')).toBe(SIN_DATO);
    expect(etiquetaCategoria(item({ ticker: 'AAA', RIESGO: 9 }), 'RIESGO')).toBe(SIN_DATO);
    expect(etiquetaCategoria(item({ ticker: 'AAA', SECTOR_GEO: undefined as unknown as string }), 'SECTOR_GEO')).toBe(SIN_DATO);
  });
});

describe('tenenciasDeDimension', () => {
  const cartera = [
    item({ ticker: 'AAA', RENTA: 'VAR' }),
    item({ ticker: 'BBB', RENTA: 'VARIABLE' }),
    item({ ticker: 'CCC', RENTA: 'FIJA' }),
  ];

  it('en geografía deja solo renta variable', () => {
    expect(tenenciasDeDimension(cartera, 'SECTOR_GEO').map(t => t.ticker)).toEqual(['AAA', 'BBB']);
  });

  it('en el resto de las dimensiones usa toda la cartera', () => {
    expect(tenenciasDeDimension(cartera, 'TIPO')).toHaveLength(3);
  });
});

describe('sumarPorCategoria / participacionPorCategoria', () => {
  const cartera = [
    item({ ticker: 'AAA', TIPO: 'ETF',  tenencia_usd: 300, tenencia_ars: 3000 }),
    item({ ticker: 'BBB', TIPO: 'ETF',  tenencia_usd: 100, tenencia_ars: 1000 }),
    item({ ticker: 'CCC', TIPO: 'BONOS', RENTA: 'FIJA', tenencia_usd: 600, tenencia_ars: 6000 }),
  ];

  it('suma por etiqueta en el campo pedido', () => {
    expect(sumarPorCategoria(cartera, 'TIPO', 'tenencia_ars')).toEqual({ ETF: 4000, BONOS: 6000 });
  });

  it('la participación es en USD sobre las tenencias de la dimensión', () => {
    expect(participacionPorCategoria(cartera, 'TIPO')).toEqual({ ETF: 40, BONOS: 60 });
    // Geografía excluye la renta fija: los dos ETF son el 100%.
    expect(participacionPorCategoria(cartera, 'SECTOR_GEO')).toEqual({ EEUU: 100 });
  });

  it('sin tenencias devuelve vacío, no NaN', () => {
    expect(participacionPorCategoria([], 'TIPO')).toEqual({});
  });
});
