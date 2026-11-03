import { NextRequest, NextResponse } from 'next/server';
import { leerGastosFijos, guardarGastosFijos, normalizarGastos } from '@/lib/gastosFijos';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const gastos = await leerGastosFijos();
    return NextResponse.json({ gastos, generatedAt: Date.now() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Reemplaza todos los gastos fijos. El body es `{ gastos: GastoFijo[] }`. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Sin este chequeo un body mal armado se normaliza a [] y vacía la hoja.
    if (!Array.isArray(body?.gastos)) {
      return NextResponse.json({ error: 'Falta la lista de gastos' }, { status: 400 });
    }
    const gastos = normalizarGastos(body.gastos);
    const cantidad = await guardarGastosFijos(gastos);
    return NextResponse.json({ ok: true, cantidad });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
