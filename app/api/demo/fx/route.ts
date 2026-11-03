import { NextRequest, NextResponse } from 'next/server';
import { buildFx } from '@/lib/demo/fixtures';
import type { FxResponse } from '@/types';

// Espejo sintético de /api/fx: serie histórica de MEP con tendencia realista
// (no ruido puro) desde el mes pedido hasta hoy.
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const desde = url.searchParams.get('desde');
    if (!desde) {
      return NextResponse.json({ error: 'Falta query param desde' }, { status: 400 });
    }

    const puntos = buildFx(desde);
    const body: FxResponse = { puntos, generatedAt: Date.now() };

    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
