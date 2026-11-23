import { NextResponse } from 'next/server';
import { buildBriefs } from '@/lib/demo/fixtures';

// Espejo sintético de /api/briefs: dos semanas de ejemplo sobre los activos de
// la demo, con texto inventado y sin links.
export async function GET() {
  try {
    return NextResponse.json({ briefs: buildBriefs() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
