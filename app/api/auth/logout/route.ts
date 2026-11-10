import { NextResponse } from 'next/server';
import { borrarSesion } from '@/lib/cookiesAuth';

// Borra la sesión y el desbloqueo. Con la sesión se va también la marca de
// bloqueo del dispositivo: el próximo ingreso con Face ID la vuelve a poner.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  borrarSesion(res);
  return res;
}
