import { NextRequest, NextResponse } from 'next/server';
import { serieSintetica } from '@/lib/demo/series';
import { ACTIVO_MAP } from '@/lib/demo/universo';
import type { HistoricoResponse, RangoHistorico } from '@/types';

// Espejo sintético de /api/performance-historico: caminata aleatoria
// determinística (seed = ticker+rango) en vez de pegarle a Yahoo. Reproducible
// entre requests para que el gráfico no "salte" al reconsultar.
export const runtime = 'nodejs';

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

    // Precio final coherente con el precioBase del universo si el ticker está
    // en cartera; si es un benchmark externo (SPY, GLD, etc.) usamos un precio
    // plausible genérico derivado del propio ticker.
    const activo = ACTIVO_MAP.get(ticker.toUpperCase());
    const precioFinal = activo?.precioBase ?? precioGenerico(ticker);

    const puntos = serieSintetica(ticker.toUpperCase(), rango, precioFinal);

    const body: HistoricoResponse = { ticker: ticker.toUpperCase(), rango, puntos, generatedAt: Date.now() };
    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Precio de referencia plausible para tickers fuera del universo de cartera
// (benchmarks de mercado usados en Ratios: GLD, TLT, BTC-USD, etc).
const PRECIOS_REFERENCIA: Record<string, number> = {
  GLD: 245,
  TLT: 92,
  'BTC-USD': 62000,
  'ETH-USD': 2600,
};

function precioGenerico(ticker: string): number {
  return PRECIOS_REFERENCIA[ticker.toUpperCase()] ?? 100;
}
