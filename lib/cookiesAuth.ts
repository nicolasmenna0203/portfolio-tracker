/**
 * Cookies de autenticación: nombres y opciones en un solo lugar, para que el
 * login con contraseña, el de passkey, el registro y el logout no difieran en
 * un flag. Ver docs/decisiones/0035-bloqueo-con-passkey-en-cada-apertura.md
 *
 * - `session`: 7 días; lleva la marca de bloqueo del dispositivo.
 * - `desbloqueo`: minutos; sin ella, una sesión con bloqueo no pasa el middleware.
 * - `webauthn_reto`: el desafío de la ceremonia en curso, acotado a las rutas
 *   de passkey y borrado apenas se usa.
 *
 * Lo importa el middleware: nada de `node:*` acá.
 */

import type { NextRequest, NextResponse } from 'next/server';
import {
  SESSION_MAX_AGE, DESBLOQUEO_MAX_AGE, RETO_MAX_AGE,
  crearToken, crearTokenDesbloqueo,
} from './session';
import type { Esperado } from './webauthn';

export const COOKIE_SESION = 'session';
export const COOKIE_DESBLOQUEO = 'desbloqueo';
export const COOKIE_RETO = 'webauthn_reto';

const RUTA_PASSKEY = '/api/auth/passkey';

function opciones(maxAge: number, path = '/') {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path,
    maxAge,
    secure: process.env.NODE_ENV === 'production',
  };
}

/** Abre sesión y deja el dispositivo desbloqueado: cualquier ingreso válido desbloquea. */
export async function emitirSesion(
  res: NextResponse,
  user: string,
  secret: string,
  bloqueo: boolean,
): Promise<void> {
  res.cookies.set(COOKIE_SESION, await crearToken(user, secret, { bloqueo }), opciones(SESSION_MAX_AGE));
  res.cookies.set(COOKIE_DESBLOQUEO, await crearTokenDesbloqueo(user, secret), opciones(DESBLOQUEO_MAX_AGE));
}

export async function renovarDesbloqueo(res: NextResponse, user: string, secret: string): Promise<void> {
  res.cookies.set(COOKIE_DESBLOQUEO, await crearTokenDesbloqueo(user, secret), opciones(DESBLOQUEO_MAX_AGE));
}

export function borrarDesbloqueo(res: NextResponse): void {
  res.cookies.set(COOKIE_DESBLOQUEO, '', opciones(0));
}

export function borrarSesion(res: NextResponse): void {
  res.cookies.set(COOKIE_SESION, '', opciones(0));
  borrarDesbloqueo(res);
}

export function guardarReto(res: NextResponse, token: string): void {
  res.cookies.set(COOKIE_RETO, token, { ...opciones(RETO_MAX_AGE, RUTA_PASSKEY), sameSite: 'strict' });
}

export function borrarReto(res: NextResponse): void {
  res.cookies.set(COOKIE_RETO, '', { ...opciones(0, RUTA_PASSKEY), sameSite: 'strict' });
}

/**
 * Origen y rpId de la ceremonia, sacados del pedido. Alcanza con eso: la firma
 * cubre el hash del rpId y el origen que puso el navegador, y una passkey
 * registrada para este dominio no firma para ningún otro, así que un Host
 * falsificado no produce una firma que verifique.
 */
export function origenDelPedido(req: NextRequest): Omit<Esperado, 'reto'> {
  return { origen: req.nextUrl.origin, rpId: req.nextUrl.hostname };
}
