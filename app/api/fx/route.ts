import { NextRequest, NextResponse } from 'next/server';
import { fetchMepAbsoluto, mesKeyToTs } from '@/lib/benchmarks';
import type { FxResponse } from '@/types';

export const revalidate = 21600; // 6 horas

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const desde = url.searchParams.get('desde');
    if (!desde) {
      return NextResponse.json({ error: 'Falta query param desde' }, { status: 400 });
    }

    const puntos = await fetchMepAbsoluto(mesKeyToTs(desde));

    const body: FxResponse = { puntos, generatedAt: Date.now() };

    return NextResponse.json(body, {
      headers: { 'Cache-Control': 's-maxage=21600, stale-while-revalidate=86400' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
