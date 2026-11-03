import { NextRequest, NextResponse } from 'next/server';
import { fetchHistoricoTicker } from '@/lib/performanceVariable';
import type { HistoricoResponse, RangoHistorico } from '@/types';

export const runtime = 'nodejs';
export const revalidate = 3600; // 1 hora

const RANGOS_VALIDOS = new Set<RangoHistorico>(['1m', '6m', '1a', '5a', '10a']);

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const ticker = url.searchParams.get('ticker');
    const rango = url.searchParams.get('rango') as RangoHistorico | null;

    if (!ticker) {
      return NextResponse.json({ error: 'Falta query param ticker' }, { status: 400 });
    }
    if (!rango || !RANGOS_VALIDOS.has(rango)) {
      return NextResponse.json({ error: 'rango inválido (usar 1m, 6m, 1a, 5a o 10a)' }, { status: 400 });
    }

    const body: HistoricoResponse = await fetchHistoricoTicker(ticker, rango);

    return NextResponse.json(body, {
      headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
