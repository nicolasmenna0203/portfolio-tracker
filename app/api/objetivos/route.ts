export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { leerObjetivos, guardarObjetivos, normalizar } from '@/lib/objetivos';

/** Objetivos de composición guardados. Estructura vacía si nunca se guardaron. */
export async function GET() {
  try {
    return NextResponse.json({ objetivos: await leerObjetivos() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Reemplaza todos los objetivos. El body es `{ objetivos: { DIMENSION: { categoria: pct } } }`.
 * Se normaliza antes de escribir: dimensiones desconocidas y porcentajes fuera
 * de 0-100 se descartan en silencio en vez de llegar al Sheet.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Sin este chequeo un body mal armado se normaliza a vacío y borra los objetivos.
    if (!body?.objetivos || typeof body.objetivos !== 'object') {
      return NextResponse.json({ error: 'Faltan los objetivos' }, { status: 400 });
    }
    const filas = await guardarObjetivos(normalizar(body.objetivos));
    return NextResponse.json({ ok: true, filas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
