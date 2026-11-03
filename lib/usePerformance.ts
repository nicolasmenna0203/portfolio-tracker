'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { PerformanceResponse } from '@/types';

interface UsePerformanceResult {
  data: PerformanceResponse | null;
  loading: boolean;
  error: string | null;
}

/** Trae TIR, TNA, duration y paridad del universo de bonos ARG, cruzado con la tenencia actual. */
export function usePerformance(tenencias: Record<string, number>): UsePerformanceResult {
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const apiBase = pathname?.startsWith('/demo') ? '/api/demo' : '/api';

  const tenenciasKey = JSON.stringify(tenencias);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${apiBase}/performance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenencias: JSON.parse(tenenciasKey) }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setData(json as PerformanceResponse);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [tenenciasKey, apiBase]);

  return { data, loading, error };
}
