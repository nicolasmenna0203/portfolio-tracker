import { NextRequest, NextResponse } from 'next/server';
import { fetchBenchmarks } from '@/lib/benchmarks';
import type { BenchmarksResponse } from '@/types';

export const revalidate = 21600; // 6 horas — datos mensuales, no hace falta más frecuencia

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const mesesParam = url.searchParams.get('meses');
    if (!mesesParam) {
      return NextResponse.json({ error: 'Falta query param meses' }, { status: 400 });
    }

    const mesesCartera = mesesParam.split(',').filter(Boolean);
    const series = await fetchBenchmarks(mesesCartera);

    const body: BenchmarksResponse = {
      baseMesKey: mesesCartera[0] ?? '',
      series,
      generatedAt: Date.now(),
    };

    return NextResponse.json(body, {
      headers: { 'Cache-Control': 's-maxage=21600, stale-while-revalidate=86400' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
