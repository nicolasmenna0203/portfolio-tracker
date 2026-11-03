import { NextRequest, NextResponse } from 'next/server';
import { fetchFciPerformance } from '@/lib/fci';
import type { FciResponse } from '@/types';

export const runtime = 'nodejs'; // necesita Buffer/zlib para descomprimir el .xlsx de CAFCI
export const revalidate = 21600; // 6 horas

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json().catch(() => ({}));
    const tenencias: Record<string, number> = payload.tenencias && typeof payload.tenencias === 'object' ? payload.tenencias : {};

    const body: FciResponse = await fetchFciPerformance(tenencias);

    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
