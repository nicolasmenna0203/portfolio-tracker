import { NextRequest, NextResponse } from 'next/server';
import { buildPerformanceVariable } from '@/lib/demo/fixtures';
import type { PerformanceVariableResponse } from '@/types';

// Espejo sintético de /api/performance-variable: fundamentals plausibles
// (P/E, market cap, 52w, dividend yield) para el universo ficticio de
// acciones/CEDEARs, sin pegarle a Yahoo.
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json().catch(() => ({}));
    const tickersUsa: string[] = Array.isArray(payload.tickersUsa) ? payload.tickersUsa.filter(Boolean) : [];
    const tenencias: Record<string, number> = payload.tenencias && typeof payload.tenencias === 'object' ? payload.tenencias : {};

    const body: PerformanceVariableResponse = buildPerformanceVariable(tickersUsa, tenencias);
    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
