import { NextRequest, NextResponse } from 'next/server';
import { leerSesion } from '@/lib/session';
import { COOKIE_SESION, emitirSesion } from '@/lib/cookiesAuth';
import { equalsSeguro } from '@/lib/timingSafe';

export async function POST(req: NextRequest) {
  // Body malformado no debe tirar un 500 con stack: es un 400 común y corriente.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Credenciales incorrectas' }, { status: 401 });
  }

  const { user, pass } = (body ?? {}) as { user?: unknown; pass?: unknown };

  const validUser = process.env.BASIC_AUTH_USER;
  const validPass = process.env.BASIC_AUTH_PASS;
  const secret = process.env.SESSION_SECRET;

  // Sin credenciales configuradas NO se puede autenticar a nadie. Antes esto
  // fallaba abierto: con las env vars ausentes, `undefined === undefined` daba
  // login válido para un body vacío `{}`.
  if (!secret || !validUser || !validPass) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  // Comparación en tiempo constante para no filtrar el largo/prefijo por timing.
  const ok =
    typeof user === 'string' &&
    typeof pass === 'string' &&
    equalsSeguro(user, validUser) &&
    equalsSeguro(pass, validPass);

  if (!ok) {
    return NextResponse.json({ error: 'Credenciales incorrectas' }, { status: 401 });
  }

  // Si el dispositivo tenía el bloqueo con Face ID, entrar con contraseña no lo
  // apaga: se mira la sesión anterior aunque haya vencido (firma válida). Si no,
  // la contraseña sería una forma silenciosa de sacar el bloqueo.
  // Ver docs/decisiones/0035-bloqueo-con-passkey-en-cada-apertura.md
  const anterior = req.cookies.get(COOKIE_SESION)?.value;
  const bloqueo = anterior
    ? (await leerSesion(anterior, secret, { ignorarExpiracion: true }))?.bloqueo === true
    : false;

  const res = NextResponse.json({ ok: true });
  await emitirSesion(res, validUser, secret, bloqueo);
  return res;
}
