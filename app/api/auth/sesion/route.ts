import { NextRequest, NextResponse } from 'next/server';
import { leerSesion } from '@/lib/session';
import { COOKIE_SESION, renovarDesbloqueo } from '@/lib/cookiesAuth';

// Latido del bloqueo con Face ID (components/BloqueoFaceId.tsx), cada 30 s
// mientras el dashboard está a la vista. Si llega hasta acá, el middleware ya
// verificó sesión y, si el dispositivo tiene bloqueo, un desbloqueo vigente:
// solo queda renovarlo. Cuando la app se va al fondo el latido se corta y el
// desbloqueo vence solo. Ver docs/decisiones/0035-bloqueo-con-passkey-en-cada-apertura.md

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  const token = req.cookies.get(COOKIE_SESION)?.value;
  const sesion = secret && token ? await leerSesion(token, secret) : null;
  if (!secret || !sesion) return NextResponse.json({ error: 'Sin sesión' }, { status: 401 });

  const res = NextResponse.json({ bloqueo: sesion.bloqueo, confianza: sesion.confianza });
  res.headers.set('Cache-Control', 'no-store');
  if (sesion.bloqueo) await renovarDesbloqueo(res, sesion.sub, secret);
  return res;
}
