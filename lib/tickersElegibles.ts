import type { TenenciaActual } from '@/types';
import { MAPEO_BONOS_ARG } from './bonosArg';

// Decisión y alternativas descartadas: docs/decisiones/0012-criterio-unico-de-tickers-elegibles.md
// Alias de símbolo y fondos clasificados como renta variable:
// docs/decisiones/0020-fuente-de-precio-por-naturaleza-del-instrumento.md
//
// Solo acciones y ETFs tienen un símbolo de mercado real cotizable en Yahoo/Finnhub.
// FCIs (los fondos del broker), bonos y activos ARG quedan afuera por defecto —
// pedirles noticias a Yahoo con un ticker inválido devuelve resultados basura (fuzzy match).
export const TIPOS_VALIDOS = new Set(['ACCIONES', 'ACCION', 'ETF']);

// Excepciones puntuales: tickers que sí tienen símbolo real en Yahoo/Finnhub pero
// quedan categorizados en el Sheet con un TIPO que no pasa el filtro de arriba (ALTS).
// IBIT/ETHA son los ETFs cripto-spot de iShares (Bitcoin/Ether Trust): cotizan
// como cualquier ETF en NASDAQ/Cboe, Yahoo los resuelve tal cual.
export const TICKERS_INCLUIR = new Set(['GLD', 'BTC', 'IBIT', 'ETHA']);

// Excepciones inversas: tickers con TIPO válido en el Sheet (ej. ETF) pero que en
// realidad son fondos del broker sin símbolo cotizable en Yahoo.
//
// "Excluir" es solo sobre Yahoo: estos tickers no tienen precio ni noticias ahí,
// pero son posiciones reales de renta variable. La fuente que sí los tiene es la
// planilla de CAFCI, vía TICKERS_FCI_EN_RENTA_VARIABLE — sin eso quedaban fuera
// de la pestaña de Renta Variable (que pide a Yahoo) y también de la de FCI (que
// lista solo los de TIPO=FCI), y su valor desaparecía del total del tab.
export const TICKERS_EXCLUIR = new Set(['COCOACCA']);

// Tickers que el Sheet clasifica como renta variable (TIPO=ETF/ACCIONES) pero que
// son fondos de CAFCI: no cotizan en Yahoo, así que su "precio" es el VCP y sus
// variaciones son los rendimientos que publica la planilla. Se resuelve por
// naturaleza del instrumento, sin tocar la clasificación del usuario: el TIPO del
// Sheet sigue siendo el que él puso, y es el que manda en el Resumen y el Informe.
export const TICKERS_FCI_EN_RENTA_VARIABLE = new Set(['COCOACCA']);

/** true si el ticker es un fondo CAFCI aunque la cartera lo clasifique como renta variable. */
export function esFciEnRentaVariable(ticker: string): boolean {
  return TICKERS_FCI_EN_RENTA_VARIABLE.has(ticker.toUpperCase());
}

// Alias de símbolo: la forma "natural" de escribir el ticker (sin el separador
// que usa Yahoo) mapeada al símbolo real. Existe para que la pestaña de Ratios
// y cualquier otro punto de entrada acepten la forma común sin que el usuario
// tenga que recordar la convención de Yahoo para acciones con clase.
export const ALIAS_TICKER_YAHOO: Record<string, string> = {
  BRKB: 'BRK-B',
  BRKA: 'BRK-A',
  BFB: 'BF-B',
};

/** Traduce un ticker a su símbolo real de Yahoo si tiene alias; si no, lo deja igual. */
export function aliasYahoo(ticker: string): string {
  return ALIAS_TICKER_YAHOO[ticker.toUpperCase()] ?? ticker;
}

/**
 * Deriva de las tenencias del último mes los insumos que necesita
 * `fetchCalendarioFinanciero`: tickers USA elegibles, tickers ARG con
 * cronograma de bonista mapeado, y el valor USD de cada posición. Devuelve
 * además `tickersFciVariable`: las posiciones de renta variable que en realidad
 * son fondos CAFCI, para que el consumidor las pida a la planilla y no a Yahoo.
 *
 * Misma regla que usa `CalendarioTab.tsx` en el cliente — se centraliza acá
 * para que el job server-side de alertas ([lib/alertas.ts](../lib/alertas.ts))
 * no duplique el criterio y se desalinee con lo que ve el usuario en pantalla.
 */
export function tickersDeCartera(items: TenenciaActual[]): {
  tickersUsa: string[];
  tickersArg: string[];
  tickersFciVariable: string[];
  tenencias: Record<string, number>;
} {
  const usa = new Set<string>();
  const arg = new Set<string>();
  const fciVariable = new Set<string>();
  const tenencias: Record<string, number> = {};

  for (const t of items) {
    const ticker = t.ticker.toUpperCase();

    const esUsa =
      !TICKERS_EXCLUIR.has(ticker) &&
      (TICKERS_INCLUIR.has(ticker) ||
        (TIPOS_VALIDOS.has(t.TIPO?.toUpperCase()) && t.SECTOR_GEO !== 'ARG'));
    if (esUsa) usa.add(ticker);

    // Fondo CAFCI clasificado como renta variable: no va a Yahoo (de ahí
    // TICKERS_EXCLUIR), pero sigue siendo una posición de renta variable que
    // el tab tiene que mostrar, con VCP y rendimientos de la planilla.
    if (esFciEnRentaVariable(ticker) && TIPOS_VALIDOS.has(t.TIPO?.toUpperCase())) {
      fciVariable.add(ticker);
    }

    if (ticker in MAPEO_BONOS_ARG) arg.add(ticker);

    if (t.tenencia_usd > 0) tenencias[ticker] = t.tenencia_usd;
  }

  return {
    tickersUsa: [...usa].sort(),
    tickersArg: [...arg].sort(),
    tickersFciVariable: [...fciVariable].sort(),
    tenencias,
  };
}
