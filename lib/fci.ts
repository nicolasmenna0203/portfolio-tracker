import type { FciPerformance, FciResponse } from '@/types';
import { fetchFciMetrics } from './fciCafci';

/** Junta las métricas de los FCI del broker (VCP, rendimientos) con las tenencias actuales de la cartera. */
export async function fetchFciPerformance(
  tenencias: Record<string, number> = {},
): Promise<FciResponse> {
  const metricsMap = await fetchFciMetrics();

  const fondos: FciPerformance[] = [...metricsMap.values()]
    .map((m) => {
      const tenenciaUsd = tenencias[m.ticker];
      return { ...m, ...(tenenciaUsd ? { tenenciaUsd } : {}) };
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  return { fondos, generatedAt: Date.now() };
}
