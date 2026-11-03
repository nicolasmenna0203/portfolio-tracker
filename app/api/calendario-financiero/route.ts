import { NextRequest, NextResponse } from 'next/server';
import { fetchCalendarioFinanciero } from '@/lib/calendario';
import type { CalendarioResponse } from '@/types';

export const runtime = 'nodejs'; // Nasdaq/bonistas requieren fetch con User-Agent en runtime Node
export const revalidate = 21600; // 6 horas

function fmtFecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json().catch(() => ({}));
    const tickersUsa: string[] = Array.isArray(payload.tickers) ? payload.tickers.filter(Boolean) : [];
    const tickersArg: string[] = Array.isArray(payload.tickersArg) ? payload.tickersArg.filter(Boolean) : [];
    const tenencias: Record<string, number> = payload.tenencias && typeof payload.tenencias === 'object' ? payload.tenencias : {};

    if (tickersUsa.length === 0 && tickersArg.length === 0) {
      return NextResponse.json({ error: 'Faltan tickers' }, { status: 400 });
    }

    const year = payload.year ? parseInt(String(payload.year), 10) : new Date().getUTCFullYear();
    const desde = fmtFecha(new Date(Date.UTC(year, 0, 1)));
    const hasta = fmtFecha(new Date(Date.UTC(year, 11, 31)));

    const body: CalendarioResponse = await fetchCalendarioFinanciero(tickersUsa, tickersArg, desde, hasta, tenencias);

    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
