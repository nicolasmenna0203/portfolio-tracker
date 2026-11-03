import { NextRequest, NextResponse } from 'next/server';
import { fetchSectorHoldings } from '@/lib/sectorHoldings';

export const runtime = 'nodejs'; // Yahoo quoteSummary requiere fetch con cookie+crumb en runtime Node
export const revalidate = 86400; // 24h, mismo TTL que el cache en memoria de fetchSectorHoldings

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const ticker = url.searchParams.get('ticker');
    if (!ticker) {
      return NextResponse.json({ error: 'Falta query param ticker' }, { status: 400 });
    }

    const info = await fetchSectorHoldings(ticker);
    if (!info) {
      return NextResponse.json({ error: `Sin datos de composición para ${ticker}` }, { status: 404 });
    }

    return NextResponse.json(info, {
      headers: { 'Cache-Control': 's-maxage=86400, stale-while-revalidate=172800' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
