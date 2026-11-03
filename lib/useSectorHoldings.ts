'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { SectorHoldingsInfo } from '@/types';

interface UseSectorHoldingsResult {
  data: SectorHoldingsInfo | null;
  loading: boolean;
  error: string | null;
}

/** Composición (top holdings, gestora, expense ratio) de un ETF sectorial. */
export function useSectorHoldings(ticker: string | null): UseSectorHoldingsResult {
  const [data, setData] = useState<SectorHoldingsInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const apiBase = pathname?.startsWith('/demo') ? '/api/demo' : '/api';

  useEffect(() => {
    if (!ticker) { setData(null); return; }
    setLoading(true);
    setError(null);
    fetch(`${apiBase}/sector-holdings?ticker=${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setData(json as SectorHoldingsInfo);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [ticker, apiBase]);

  return { data, loading, error };
}
