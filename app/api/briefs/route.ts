export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { leerBriefs } from '@/lib/briefsGuardados';

/**
 * Briefs semanales guardados, del más nuevo al más viejo. Los guarda el job del
 * domingo (app/api/alertas/semanal); acá solo se leen. Lista vacía si todavía
 * no se guardó ninguno.
 */
export async function GET() {
  try {
    return NextResponse.json({ briefs: await leerBriefs() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
