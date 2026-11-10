import { NextRequest, NextResponse } from 'next/server';
import { buildCalendario } from '@/lib/demo/fixtures';
import type { CalendarioResponse } from '@/types';

// Espejo sintético de /api/calendario-financiero: ignora los tickers y las
// tenencias del body y devuelve eventos fijos con fechas relativas a hoy,
// cubriendo los 5 EventoTipo. El `year` sí se respeta, igual que la ruta real:
// la pestaña pide el año en curso y el siguiente y los junta, así que sin el
// filtro cada evento aparecía dos veces.
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json().catch(() => ({}));
    const year = payload?.year ? parseInt(String(payload.year), 10) : new Date().getUTCFullYear();
    const completo = buildCalendario();
    const body: CalendarioResponse = {
      ...completo,
      eventos: completo.eventos.filter((e) => e.fecha.startsWith(`${year}-`)),
    };
    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
