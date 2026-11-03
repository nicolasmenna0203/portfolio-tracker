// Generación de series de precio sintéticas por caminata aleatoria determinística
// (seed = ticker), compartida por /api/demo/performance-historico y
// /api/demo/ratio para que ambos endpoints deriven del mismo generador.

import type { PrecioHistoricoPunto, RangoHistorico } from '@/types';
import { gaussian, rngFromString } from './rng';

/** Cantidad de puntos (hábiles aprox.) por rango, igual criterio que usa el resto del dashboard. */
export const PUNTOS_POR_RANGO: Record<RangoHistorico, number> = {
  '1m': 22,
  '6m': 130,
  '1a': 260,
  '5a': 260 * 5,
  '10a': 260 * 10,
};

/** Días de calendario a retroceder por rango (aprox., para las fechas de los puntos). */
const DIAS_POR_RANGO: Record<RangoHistorico, number> = {
  '1m': 31,
  '6m': 183,
  '1a': 365,
  '5a': 365 * 5,
  '10a': 365 * 10,
};

/**
 * Serie de cierre diario para un ticker, vía caminata aleatoria log-normal con
 * drift leve. Determinística por ticker+rango: mismo pedido, misma serie,
 * sin necesidad de persistir nada entre requests.
 */
export function serieSintetica(ticker: string, rango: RangoHistorico, precioFinal: number): PrecioHistoricoPunto[] {
  const n = PUNTOS_POR_RANGO[rango];
  const rng = rngFromString(`${ticker}:${rango}`);
  const diasTotales = DIAS_POR_RANGO[rango];

  // Drift y volatilidad diaria moderados, plausibles para un activo financiero.
  const volDiaria = 0.012 + (rng() * 0.01); // 1.2%-2.2% diario
  const driftDiario = 0.0002 + (rng() - 0.5) * 0.0004;

  // Generamos la caminata hacia atrás desde el precio final conocido, para que
  // el último punto de la serie siempre coincida con `precioFinal` (coherente
  // con el precio usado en tenencias/holdings).
  const logPrecios: number[] = new Array(n);
  logPrecios[n - 1] = Math.log(precioFinal);
  for (let i = n - 2; i >= 0; i--) {
    const retorno = driftDiario + volDiaria * gaussian(rng);
    logPrecios[i] = logPrecios[i + 1] - retorno;
  }

  const hoy = Date.now();
  const msPorPunto = (diasTotales * 24 * 3600 * 1000) / n;

  return logPrecios.map((lp, i) => {
    const ts = hoy - (n - 1 - i) * msPorPunto;
    const fecha = new Date(ts).toISOString().slice(0, 10);
    return { fecha, close: Math.round(Math.exp(lp) * 100) / 100 };
  });
}
