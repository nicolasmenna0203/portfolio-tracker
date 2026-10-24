import { NextRequest, NextResponse } from 'next/server';
import { fetchPerformanceVariable } from '@/lib/performanceVariable';
import type { PerformanceVariableResponse } from '@/types';

export const runtime = 'nodejs'; // Yahoo quoteSummary requiere fetch con cookie+crumb en runtime Node
export const revalidate = 3600; // 1 hora, mismo TTL que datosAcciones/fetchFundamentals

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json().catch(() => ({}));
    const tickersUsa: string[] = Array.isArray(payload.tickersUsa) ? payload.tickersUsa.filter(Boolean) : [];
    const tenencias: Record<string, number> = payload.tenencias && typeof payload.tenencias === 'object' ? payload.tenencias : {};
    // Posiciones de renta variable que son fondos CAFCI: se resuelven contra la
    // planilla, no contra Yahoo (ver lib/performanceVariable.ts).
    const tickersFci: string[] = Array.isArray(payload.tickersFci) ? payload.tickersFci.filter(Boolean) : [];

    const body: PerformanceVariableResponse = await fetchPerformanceVariable(tickersUsa, tenencias, tickersFci);

    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
