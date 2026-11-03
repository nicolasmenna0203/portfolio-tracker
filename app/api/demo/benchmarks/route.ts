import { NextRequest, NextResponse } from 'next/server';
import { buildBenchmarks } from '@/lib/demo/fixtures';
import type { BenchmarksResponse } from '@/types';

// Espejo sintético de /api/benchmarks para /demo: mismo contrato de query params
// y respuesta, pero genera series índice-100 determinísticas en vez de pegarle
// a fuentes externas. Nunca toca red ni Google Sheets.
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const mesesParam = url.searchParams.get('meses');
    const mesesCartera = mesesParam ? mesesParam.split(',').filter(Boolean) : [];

    const series = buildBenchmarks(mesesCartera);

    const body: BenchmarksResponse = {
      baseMesKey: mesesCartera[0] ?? series[0]?.puntos[0]?.mesKey ?? '',
      series,
      generatedAt: Date.now(),
    };

    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
