'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { PerformanceVariableResponse } from '@/types';

interface UsePerformanceVariableResult {
  data: PerformanceVariableResponse | null;
  loading: boolean;
  error: string | null;
}

/**
 * Trae precio, fundamentals (P/E, market cap, 52w) y variaciones del universo de
 * acciones/CEDEARs/ETF de la cartera. `tickersFci` son las posiciones de renta
 * variable que son fondos CAFCI: vienen con VCP y rendimientos de la planilla.
 */
export function usePerformanceVariable(
  tickersUsa: string[],
  tenencias: Record<string, number>,
  tickersFci: string[] = [],
): UsePerformanceVariableResult {
  const [data, setData] = useState<PerformanceVariableResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const apiBase = pathname?.startsWith('/demo') ? '/api/demo' : '/api';

  const tickersKey = JSON.stringify(tickersUsa);
  const tenenciasKey = JSON.stringify(tenencias);
  const tickersFciKey = JSON.stringify(tickersFci);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${apiBase}/performance-variable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tickersUsa: JSON.parse(tickersKey),
        tenencias: JSON.parse(tenenciasKey),
        tickersFci: JSON.parse(tickersFciKey),
      }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setData(json as PerformanceVariableResponse);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [tickersKey, tenenciasKey, tickersFciKey, apiBase]);

  return { data, loading, error };
}
