import { NextResponse } from 'next/server';
import { buildGastosFijos } from '@/lib/demo/fixtures';

// Espejo sintético de /api/gastos-fijos: catálogo fijo de gastos ficticios.
export async function GET() {
  try {
    const body = buildGastosFijos();
    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// El POST no persiste nada en la demo: no hay Sheet detrás. Devuelve ok para
// que el form de la UI no rompa si alguien prueba a guardar.
export async function POST() {
  return NextResponse.json({ ok: true, cantidad: 0 });
}
