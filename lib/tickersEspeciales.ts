// Tickers con una regla puntual que no se deduce de su clasificación en el Sheet.
//
// Viven en la hoja TickersEspeciales y no en el código: una lista de excepciones
// así existe porque esos activos están en la cartera, y el código se publica (ver
// docs/decisiones/0030-repo-privado-y-espejo-publico.md). Módulo puro, como
// fondosCafci.ts, para que lo usen sheets.ts y bondMetrics.ts sin importarse
// entre sí.

export const RANGO_TICKERS_ESPECIALES = 'TickersEspeciales!A:B';

export interface TickersEspeciales {
  /**
   * REGLA=COTIZA: tienen símbolo real en Yahoo/Finnhub pero el Sheet los
   * clasifica con un TIPO que no pasa el filtro de lib/tickersElegibles.ts (ej.
   * un ETF de oro o uno cripto-spot cargado como ALTS).
   */
  cotiza: Set<string>;
  /** REGLA=EXCLUIR_BONO: no se muestran en el universo de renta fija de bonistas. */
  excluirBono: Set<string>;
}

/** Filas de la hoja (TICKER, REGLA) → tickers por regla. Una regla desconocida se ignora. */
export function parsearTickersEspeciales(filas: Record<string, string>[]): TickersEspeciales {
  const out: TickersEspeciales = { cotiza: new Set(), excluirBono: new Set() };
  for (const f of filas) {
    const ticker = (f['TICKER'] ?? '').trim().toUpperCase();
    const regla = (f['REGLA'] ?? '').trim().toUpperCase();
    if (!ticker) continue;
    if (regla === 'COTIZA') out.cotiza.add(ticker);
    else if (regla === 'EXCLUIR_BONO') out.excluirBono.add(ticker);
  }
  return out;
}
