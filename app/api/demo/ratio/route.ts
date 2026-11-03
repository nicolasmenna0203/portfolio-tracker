import { NextRequest, NextResponse } from 'next/server';
import { serieSintetica } from '@/lib/demo/series';
import { ACTIVO_MAP } from '@/lib/demo/universo';
import { serieRatio, estadisticas } from '@/lib/ratios';
import { normalizarTicker, esRango } from '@/lib/ratiosGuardados';
import type { RangoHistorico, RatioResponse } from '@/types';

// Espejo sintético de /api/ratio: genera las dos series sintéticas (mismo
// generador que /api/demo/performance-historico) y deriva percentil/zScore/
// correlación/beta con las mismas funciones puras que usa el endpoint real
// (lib/ratios.ts), para que las estadísticas sean matemáticamente consistentes
// con las series, no inventadas por separado.
const PRECIOS_REFERENCIA: Record<string, number> = {
  GLD: 245,
  TLT: 92,
  'BTC-USD': 62000,
  'ETH-USD': 2600,
};

function precioFinalDe(ticker: string): number {
  const activo = ACTIVO_MAP.get(ticker);
  if (activo) return activo.precioBase;
  return PRECIOS_REFERENCIA[ticker] ?? 100;
}

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

    const puntosA = serieSintetica(activoA, rango, precioFinalDe(activoA));
    const puntosB = serieSintetica(activoB, rango, precioFinalDe(activoB));

    const serie = serieRatio(puntosA, puntosB);

    const body: RatioResponse = {
      activoA,
      activoB,
      rango,
      puntos: serie,
      estadisticas: estadisticas(serie),
      generatedAt: Date.now(),
    };

    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
