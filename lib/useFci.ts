'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { FciResponse } from '@/types';

interface UseFciResult {
  data: FciResponse | null;
  loading: boolean;
  error: string | null;
}

/** Trae VCP y rendimientos de los FCI del broker, cruzado con la tenencia actual. */
export function useFci(tenencias: Record<string, number>): UseFciResult {
  const [data, setData] = useState<FciResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const apiBase = pathname?.startsWith('/demo') ? '/api/demo' : '/api';

  const tenenciasKey = JSON.stringify(tenencias);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${apiBase}/fci`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenencias: JSON.parse(tenenciasKey) }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setData(json as FciResponse);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [tenenciasKey, apiBase]);

  return { data, loading, error };
}
