import { NextRequest, NextResponse } from 'next/server';
import { crearReto, verificarReto } from '@/lib/session';
import { preverificarAcceso, verificarAcceso, type RespuestaAcceso } from '@/lib/webauthn';
import { leerPasskeys } from '@/lib/passkeys';
import { COOKIE_RETO, emitirSesion, guardarReto, borrarReto, origenDelPedido } from '@/lib/cookiesAuth';

// Ingreso (y desbloqueo) con passkey. Pública en el middleware: es la puerta de
// entrada. Ver docs/decisiones/0035-bloqueo-con-passkey-en-cada-apertura.md
//
// GET  → desafío nuevo, firmado en una cookie (el servidor no guarda estado).
// POST → verifica la firma contra la clave guardada en la hoja Passkeys y abre
//        una sesión con bloqueo: quien entra con Face ID lo va a necesitar
//        también para volver a abrir la app en ese dispositivo. Con
//        `recordar: true` (lo ofrece el login en una compu) la sesión es de
//        confianza: 30 días y sin bloqueo. Ver docs/decisiones/0038-compu-de-confianza.md
//
// Sin `allowCredentials`: las passkeys se registran como credenciales
// descubribles, así que el sistema ofrece las que tiene para este dominio sin
// que este endpoint público tenga que listar los ids registrados.
//
// Antes de leer la hoja se chequea todo lo que no necesita la clave pública
// (desafío, origen, rpId, flags): leer la hoja gasta cuota de Google Sheets, y
// cualquiera puede pedir un reto. Ver docs/decisiones/0037-ingreso-solo-con-passkey.md

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });

  const { reto, token } = await crearReto(secret);
  const res = NextResponse.json({ reto, rpId: origenDelPedido(req).rpId });
  guardarReto(res, token);
  return res;
}

export async function POST(req: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  const user = process.env.BASIC_AUTH_USER;
  if (!secret || !user) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });

  const rechazo = () => {
    const res = NextResponse.json({ error: 'No se pudo verificar la passkey' }, { status: 401 });
    borrarReto(res);
    return res;
  };

  const tokenReto = req.cookies.get(COOKIE_RETO)?.value;
  const reto = tokenReto ? await verificarReto(tokenReto, secret) : null;
  if (!reto) return rechazo();

  let body: RespuestaAcceso & { recordar?: unknown };
  try {
    body = (await req.json()) as RespuestaAcceso & { recordar?: unknown };
  } catch {
    return rechazo();
  }

  const esperado = { reto, ...origenDelPedido(req) };
  const previo = await preverificarAcceso(body, esperado);
  if (!previo.ok) {
    console.warn('[passkey/acceso] rechazada antes de leer la hoja:', previo.motivo);
    return rechazo();
  }

  let passkeys;
  try {
    passkeys = await leerPasskeys();
  } catch (err) {
    console.error('[passkey/acceso] no se pudo leer la hoja Passkeys:', err);
    return NextResponse.json({ error: 'No se pudieron leer las passkeys' }, { status: 502 });
  }

  const passkey = passkeys.find((p) => p.id === body?.id);
  if (!passkey) return rechazo();

  const resultado = await verificarAcceso(body, passkey.clavePublica, esperado);
  if (!resultado.ok) {
    console.warn('[passkey/acceso] rechazada:', resultado.motivo);
    return rechazo();
  }

  const res = NextResponse.json({ ok: true });
  const confianza = body.recordar === true;
  await emitirSesion(res, user, secret, { bloqueo: !confianza, confianza });
  borrarReto(res);
  return res;
}
