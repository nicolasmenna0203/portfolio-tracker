import { NextResponse } from 'next/server';
import { ultimoMesCerrado } from '@/lib/estadoCargas';
import type { EstadoCargas } from '@/types';

export const dynamic = 'force-dynamic';

// Espejo sintético de /api/estado-cargas: con un archivo pendiente, para que la
// demo muestre los dos estados de los íconos.
export async function GET() {
  const body: EstadoCargas = {
    mes: ultimoMesCerrado(new Date()),
    tenencias: true,
    movimientos: true,
    haberes: false,
  };
  return NextResponse.json(body);
}
