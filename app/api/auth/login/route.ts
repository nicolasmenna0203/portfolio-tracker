import { NextRequest, NextResponse, after } from 'next/server';
import { leerSesion, contrasenaHabilitada } from '@/lib/session';
import { COOKIE_SESION, emitirSesion } from '@/lib/cookiesAuth';
import { equalsSeguro } from '@/lib/timingSafe';
import { avisarSeguridad, datosDelPedido } from '@/lib/avisoSeguridad';

// Ingreso con contraseña. En producción está apagado: se entra solo con
// passkey, y `PERMITIR_CONTRASENA=true` en Vercel lo prende para recuperar el
// acceso. Apagado, responde lo mismo para cualquier credencial, sin compararla:
// no sirve ni para probar contraseñas. Prendido, cada ingreso manda un aviso
// por mail. Ver docs/decisiones/0037-ingreso-solo-con-passkey.md
export async function POST(req: NextRequest) {
  if (!contrasenaHabilitada()) {
    return NextResponse.json(
      { error: 'El ingreso con contraseña está desactivado. Entrá con Face ID o con una passkey.' },
      { status: 403 },
    );
  }

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

  const datos = datosDelPedido(req);
  after(() => avisarSeguridad('ingreso-con-contrasena', datos));

  const res = NextResponse.json({ ok: true });
  await emitirSesion(res, validUser, secret, bloqueo);
  return res;
}
