import { describe, it, expect } from 'vitest';
import { tickersDeCartera, aliasYahoo } from './tickersElegibles';
import type { TenenciaActual } from '@/types';

function item(partial: Partial<TenenciaActual> & { ticker: string }): TenenciaActual {
  return {
    tenencia_ars: 0,
    tenencia_usd: 0,
    fechaTs: 0,
    fechaMes: '2026-07',
    TIPO: 'ACCION',
    RIESGO: 1,
    SECTOR_GEO: 'USA',
    RENTA: 'Variable',
    MONEDA: 'USD',
    ...partial,
  };
}

describe('tickersDeCartera', () => {
  it('incluye acciones/ETFs que no son ARG', () => {
    const { tickersUsa } = tickersDeCartera([item({ ticker: 'AAPL', TIPO: 'ACCION' })]);
    expect(tickersUsa).toEqual(['AAPL']);
  });

  it('excluye activos ARG aunque el tipo sea válido', () => {
    const { tickersUsa } = tickersDeCartera([item({ ticker: 'PAMP', TIPO: 'ACCION', SECTOR_GEO: 'ARG' })]);
    expect(tickersUsa).toEqual([]);
  });

  it('excluye FCIs y otros tipos no cotizables', () => {
    const { tickersUsa } = tickersDeCartera([item({ ticker: 'FDOOCHO', TIPO: 'FCI' })]);
    expect(tickersUsa).toEqual([]);
  });

  it('incluye un ticker marcado cotizaEnMercado aunque el TIPO no sea válido', () => {
    const { tickersUsa } = tickersDeCartera([item({ ticker: 'XMPL', TIPO: 'ALTS', cotizaEnMercado: true })]);
    expect(tickersUsa).toEqual(['XMPL']);
  });

  it('sin la marca, un TIPO no válido queda afuera', () => {
    const { tickersUsa } = tickersDeCartera([item({ ticker: 'XMPL', TIPO: 'ALTS' })]);
    expect(tickersUsa).toEqual([]);
  });

  it('respeta la excepción de exclusión (FDOCINCO) aunque el TIPO sea válido', () => {
    const { tickersUsa } = tickersDeCartera([item({ ticker: 'FDOCINCO', fciEnRentaVariable: true, TIPO: 'ETF' })]);
    expect(tickersUsa).toEqual([]);
  });

  // No alcanza con excluirlo de Yahoo: es una posición de renta variable real,
  // y si no sale por ninguna lista su valor desaparece del total del tab.
  it('devuelve el fondo clasificado como renta variable en tickersFciVariable', () => {
    const { tickersUsa, tickersFciVariable } = tickersDeCartera([
      item({ ticker: 'FDOCINCO', fciEnRentaVariable: true, TIPO: 'ETF', tenencia_usd: 457 }),
    ]);
    expect(tickersUsa).toEqual([]);              // no va a Yahoo
    expect(tickersFciVariable).toEqual(['FDOCINCO']); // sí va a CAFCI
  });

  it('no mete en tickersFciVariable a un fondo que el Sheet clasifica como FCI', () => {
    const { tickersFciVariable } = tickersDeCartera([item({ ticker: 'FDOCINCO', fciEnRentaVariable: true, TIPO: 'FCI' })]);
    expect(tickersFciVariable).toEqual([]);
  });

  it('no marca como fondo a una acción común', () => {
    const { tickersUsa, tickersFciVariable } = tickersDeCartera([item({ ticker: 'KO', TIPO: 'ACCION' })]);
    expect(tickersUsa).toEqual(['KO']);
    expect(tickersFciVariable).toEqual([]);
  });

  it('detecta bonos ARG mapeados para tickersArg', () => {
    const { tickersArg } = tickersDeCartera([item({ ticker: 'GD35', TIPO: 'BONO', SECTOR_GEO: 'ARG' })]);
    expect(tickersArg).toEqual(['GD35']);
  });

  it('no incluye en tickersArg un bono sin mapeo', () => {
    const { tickersArg } = tickersDeCartera([item({ ticker: 'NOEXISTE99', TIPO: 'BONO', SECTOR_GEO: 'ARG' })]);
    expect(tickersArg).toEqual([]);
  });

  it('solo incluye tenencia_usd positiva en el mapa de tenencias', () => {
    const { tenencias } = tickersDeCartera([
      item({ ticker: 'AAPL', tenencia_usd: 500 }),
      item({ ticker: 'JPM', tenencia_usd: 0 }),
    ]);
    expect(tenencias).toEqual({ AAPL: 500 });
  });

  it('normaliza tickers a mayúsculas', () => {
    const { tickersUsa, tenencias } = tickersDeCartera([item({ ticker: 'aapl', tenencia_usd: 10 })]);
    expect(tickersUsa).toEqual(['AAPL']);
    expect(tenencias).toEqual({ AAPL: 10 });
  });
});

describe('aliasYahoo', () => {
  it('traduce la forma sin separador al símbolo real de Yahoo', () => {
    expect(aliasYahoo('BFB')).toBe('BF-B');
    expect(aliasYahoo('bfb')).toBe('BF-B');
  });

  it('deja sin cambios un ticker sin alias', () => {
    expect(aliasYahoo('AAPL')).toBe('AAPL');
  });
});
