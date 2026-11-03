import { NextResponse } from 'next/server';
import { fetchIngresos } from '@/lib/ingresos';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const body = await fetchIngresos();
    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
