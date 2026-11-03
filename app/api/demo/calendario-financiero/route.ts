import { NextResponse } from 'next/server';
import { buildCalendario } from '@/lib/demo/fixtures';
import type { CalendarioResponse } from '@/types';

// Espejo sintético de /api/calendario-financiero: ignora el body real (tickers,
// tickersArg, tenencias, year) y devuelve eventos fijos con fechas relativas a
// hoy, cubriendo los 5 EventoTipo.
export async function POST() {
  try {
    const body: CalendarioResponse = buildCalendario();
    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
