// Fondos del broker que se buscan en la planilla de CAFCI (lib/fciCafci.ts).
//
// Viven en la hoja FondosCAFCI del Sheet y no en el código porque sus nombres y
// tickers identifican al broker, y el repo es público. Este módulo es puro para
// que lo usen tanto sheets.ts como fciCafci.ts sin que se importen entre sí.

export const RANGO_FONDOS_CAFCI = 'FondosCAFCI!A:D';

export interface FondoCafci {
  /** Nombre exacto de fondo+clase en la planilla CAFCI. */
  nombre: string;
  /**
   * true si el Sheet lo clasifica como renta variable (TIPO=ETF): no se le piden
   * datos a Yahoo y la pestaña de FCI no lo cuenta. Ver
   * docs/decisiones/0020-fuente-de-precio-por-naturaleza-del-instrumento.md.
   */
  rentaVariable: boolean;
  /**
   * Categoría del espejo de argentinadatos (ver lib/fciHistorico.ts), para los
   * fondos que pueden necesitar completar el 12 meses. Es un dato de esa API, no
   * de CAFCI: el mismo fondo puede estar clasificado distinto en cada fuente (ej.
   * horizonte "largo" en CAFCI puede caer en "rentaFija" ahí). Agregarla no cambia
   * nada si CAFCI ya publica el fondo completo.
   */
  categoriaHistorico?: string;
}

/** Filas de la hoja (TICKER, NOMBRE_CAFCI, RENTA_VARIABLE, CATEGORIA_HISTORICO) → fondos por ticker. */
export function parsearFondos(filas: Record<string, string>[]): Record<string, FondoCafci> {
  const fondos: Record<string, FondoCafci> = {};
  for (const f of filas) {
    const ticker = (f['TICKER'] ?? '').trim().toUpperCase();
    const nombre = (f['NOMBRE_CAFCI'] ?? '').trim();
    if (!ticker || !nombre) continue;
    const categoria = (f['CATEGORIA_HISTORICO'] ?? '').trim();
    fondos[ticker] = {
      nombre,
      rentaVariable: (f['RENTA_VARIABLE'] ?? '').trim().toUpperCase() === 'SI',
      ...(categoria ? { categoriaHistorico: categoria } : {}),
    };
  }
  return fondos;
}
