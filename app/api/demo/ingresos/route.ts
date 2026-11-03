import { NextResponse } from 'next/server';
import { buildIngresos } from '@/lib/demo/fixtures';

// Espejo sintético de /api/ingresos: varios meses de ingresos ficticios de dos
// "empleadores" genéricos.
export async function GET() {
  try {
    const body = buildIngresos();
    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
