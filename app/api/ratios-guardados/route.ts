export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { leerRatios, guardarRatios, normalizarLista } from '@/lib/ratiosGuardados';

/** Pares de ratio guardados. Lista vacía si nunca se guardó ninguno. */
export async function GET() {
  try {
    return NextResponse.json({ ratios: await leerRatios() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Reemplaza la lista completa de pares. El body es `{ ratios: [...] }`.
 * Se normaliza antes de escribir: pares malformados o duplicados se descartan
 * en silencio en vez de llegar al Sheet.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Sin este chequeo un body mal armado se normaliza a [] y vacía la hoja.
    if (!Array.isArray(body?.ratios)) {
      return NextResponse.json({ error: 'Falta la lista de pares' }, { status: 400 });
    }
    const ratios = normalizarLista(body.ratios);
    const filas = await guardarRatios(ratios);
    return NextResponse.json({ ok: true, filas, ratios });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
