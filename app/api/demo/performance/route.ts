import { NextRequest, NextResponse } from 'next/server';
import { buildPerformance } from '@/lib/demo/fixtures';
import type { PerformanceResponse } from '@/types';

// Espejo sintético de /api/performance: universo de bonos ARG ficticio con TIR,
// duration, paridad y sensibilidad coherentes por GrupoBono, sin pegarle a
// bonistas.com.
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json().catch(() => ({}));
    const tenencias: Record<string, number> = payload.tenencias && typeof payload.tenencias === 'object' ? payload.tenencias : {};

    const body: PerformanceResponse = buildPerformance(tenencias);
    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
