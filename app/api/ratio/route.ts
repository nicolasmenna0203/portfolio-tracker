import { NextRequest, NextResponse } from 'next/server';
import { fetchHistoricoTicker } from '@/lib/performanceVariable';
import { serieRatio, estadisticas } from '@/lib/ratios';
import { normalizarTicker, esRango } from '@/lib/ratiosGuardados';
import type { RangoHistorico, RatioResponse } from '@/types';

export const runtime = 'nodejs';
export const revalidate = 3600; // 1 hora

/**
 * Serie del ratio A/B en el rango pedido.
 *
 * Las dos patas se bajan con `fetchHistoricoTicker`, que ya cachea por
 * ticker+rango una hora: mirar tres pares que comparten el mismo activo de
 * referencia cuesta una sola descarga de esa pata.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const activoA = normalizarTicker(url.searchParams.get('a'));
    const activoB = normalizarTicker(url.searchParams.get('b'));
    const rangoRaw = url.searchParams.get('rango') ?? '';

    if (!activoA || !activoB) {
      return NextResponse.json({ error: 'Faltan o son inválidos los query params a y b' }, { status: 400 });
    }
    if (activoA === activoB) {
      return NextResponse.json({ error: 'El ratio de un activo contra sí mismo es constante 1' }, { status: 400 });
    }
    if (!esRango(rangoRaw)) {
      return NextResponse.json({ error: 'rango inválido (usar 1m, 6m, 1a, 5a o 10a)' }, { status: 400 });
    }
    const rango: RangoHistorico = rangoRaw;

    const [histA, histB] = await Promise.all([
      fetchHistoricoTicker(activoA, rango),
      fetchHistoricoTicker(activoB, rango),
    ]);

    const serie = serieRatio(histA.puntos, histB.puntos);

    const body: RatioResponse = {
      activoA,
      activoB,
      rango,
      puntos: serie,
      estadisticas: estadisticas(serie),
      generatedAt: Date.now(),
    };

    return NextResponse.json(body, {
      headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
