import { NextRequest, NextResponse } from 'next/server';
import { fetchPerformance } from '@/lib/performance';
import type { PerformanceResponse } from '@/types';

export const runtime = 'nodejs'; // bonistas.com requiere fetch con User-Agent en runtime Node
export const revalidate = 21600; // 6 horas

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json().catch(() => ({}));
    const tenencias: Record<string, number> = payload.tenencias && typeof payload.tenencias === 'object' ? payload.tenencias : {};

    const body: PerformanceResponse = await fetchPerformance(tenencias);

    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
