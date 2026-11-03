'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { FxResponse } from '@/types';

interface UseFxResult {
  mepPorMes: Map<string, number>;
  loading: boolean;
  error: string | null;
}

/** Trae el dólar MEP histórico absoluto (pesos por dólar) por mes, desde el mes indicado hasta hoy. */
export function useFx(primerMes: string | null): UseFxResult {
  const [resp, setResp] = useState<FxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const apiBase = pathname?.startsWith('/demo') ? '/api/demo' : '/api';

  useEffect(() => {
    if (!primerMes) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    fetch(`${apiBase}/fx?desde=${primerMes}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setResp(json as FxResponse);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [primerMes, apiBase]);

  const mepPorMes = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of resp?.puntos ?? []) map.set(p.mesKey, p.valorArs);
    return map;
  }, [resp]);

  return { mepPorMes, loading, error };
}
