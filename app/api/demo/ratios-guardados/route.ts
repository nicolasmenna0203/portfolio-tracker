import { NextResponse } from 'next/server';
import { buildRatiosGuardados } from '@/lib/demo/fixtures';

// Espejo sintético de /api/ratios-guardados. GET devuelve 2-3 pares de ejemplo;
// POST es un no-op de éxito fingido, no persiste nada.
export async function GET() {
  try {
    return NextResponse.json({ ratios: buildRatiosGuardados() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST() {
  return NextResponse.json({ ok: true });
}
