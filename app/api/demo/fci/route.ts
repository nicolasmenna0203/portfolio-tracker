import { NextRequest, NextResponse } from 'next/server';
import { buildFci } from '@/lib/demo/fixtures';
import type { FciResponse } from '@/types';

// Espejo sintético de /api/fci: fondos ficticios con VCP/rendimientos
// coherentes, cruzados con la tenencia enviada en el body (si la hay).
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json().catch(() => ({}));
    const tenencias: Record<string, number> = payload.tenencias && typeof payload.tenencias === 'object' ? payload.tenencias : {};

    const body: FciResponse = buildFci(tenencias);
    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
