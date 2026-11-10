import { NextRequest, NextResponse } from 'next/server';
import { crearReto, verificarReto, leerSesion, b64urlEncode } from '@/lib/session';
import { verificarRegistro, ALG_ES256, type RespuestaRegistro } from '@/lib/webauthn';
import { leerPasskeys, agregarPasskey, nombreDispositivo } from '@/lib/passkeys';
import {
  COOKIE_SESION, COOKIE_RETO, emitirSesion, guardarReto, borrarReto, origenDelPedido,
} from '@/lib/cookiesAuth';

// Alta de una passkey en este dispositivo. Exige sesión (no está en las rutas
// públicas del middleware): la clave pública que manda el navegador se acepta
// sin attestation porque quien la manda ya está autenticado.
// Ver docs/decisiones/0035-bloqueo-con-passkey-en-cada-apertura.md
//
// GET  → opciones para `navigator.credentials.create`.
// POST → verifica, agrega la fila a la hoja Passkeys y reemite la sesión con
//        bloqueo: desde ahora este dispositivo pide Face ID al abrir la app.

export const dynamic = 'force-dynamic';

// Fijo y sin datos personales: el sistema reemplaza la passkey anterior de este
// sitio con el mismo user.id, así que registrar de nuevo no acumula passkeys
// huérfanas en el llavero.
const USER_ID = b64urlEncode(new TextEncoder().encode('portfolio-tracker'));

export async function GET(req: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });

  let registradas;
  try {
    registradas = await leerPasskeys();
  } catch (err) {
    console.error('[passkey/registro] no se pudo leer la hoja Passkeys:', err);
    return NextResponse.json({ error: 'No se pudieron leer las passkeys' }, { status: 502 });
  }

  const { reto, token } = await crearReto(secret);
  const res = NextResponse.json({
    reto,
    rp: { name: 'Portfolio', id: origenDelPedido(req).rpId },
    user: { id: USER_ID, name: 'Portfolio', displayName: 'Portfolio' },
    alg: ALG_ES256,
    excluir: registradas.map((p) => p.id),
  });
  guardarReto(res, token);
  return res;
}

export async function POST(req: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });

  // El middleware ya dejó pasar la sesión; se relee para reemitirla con bloqueo.
  const tokenSesion = req.cookies.get(COOKIE_SESION)?.value;
  const sesion = tokenSesion ? await leerSesion(tokenSesion, secret) : null;
  if (!sesion) return NextResponse.json({ error: 'Sin sesión' }, { status: 401 });

  const tokenReto = req.cookies.get(COOKIE_RETO)?.value;
  const reto = tokenReto ? await verificarReto(tokenReto, secret) : null;

  let body: RespuestaRegistro;
  try {
    body = (await req.json()) as RespuestaRegistro;
  } catch {
    body = {} as RespuestaRegistro;
  }

  const resultado = reto
    ? await verificarRegistro(body, { reto, ...origenDelPedido(req) })
    : { ok: false as const, motivo: 'desafío vencido' };

  if (!resultado.ok) {
    console.warn('[passkey/registro] rechazada:', resultado.motivo);
    const res = NextResponse.json({ error: `No se pudo registrar: ${resultado.motivo}` }, { status: 400 });
    borrarReto(res);
    return res;
  }

  try {
    await agregarPasskey({
      id: resultado.valor.id,
      clavePublica: resultado.valor.clavePublica,
      dispositivo: nombreDispositivo(req.headers.get('user-agent') ?? ''),
      creada: new Date().toISOString().slice(0, 10),
    });
  } catch (err) {
    console.error('[passkey/registro] no se pudo escribir la hoja Passkeys:', err);
    return NextResponse.json({ error: 'No se pudo guardar la passkey en el Sheet' }, { status: 502 });
  }

  const res = NextResponse.json({ ok: true });
  await emitirSesion(res, sesion.sub, secret, true);
  borrarReto(res);
  return res;
}
