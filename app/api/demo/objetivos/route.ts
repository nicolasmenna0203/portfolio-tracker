import { NextResponse } from 'next/server';
import { buildObjetivos } from '@/lib/demo/fixtures';

// Espejo sintético de /api/objetivos. GET devuelve objetivos de ejemplo fijos;
// POST es un no-op de éxito fingido: no persiste nada (no hay Sheet detrás de
// /demo), solo responde como si hubiera guardado.
export async function GET() {
  try {
    return NextResponse.json({ objetivos: buildObjetivos() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST() {
  return NextResponse.json({ ok: true, filas: 0 });
}
