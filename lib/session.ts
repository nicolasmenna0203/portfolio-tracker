/**
 * Tokens firmados (HMAC-SHA256) para la sesión, el desbloqueo con Face ID y el
 * desafío de WebAuthn. Nunca el secreto en texto plano.
 *
 * Decisiones y alternativas descartadas:
 * docs/decisiones/0014-hmac-webcrypto-por-edge-runtime.md (sesión firmada)
 * docs/decisiones/0035-bloqueo-con-passkey-en-cada-apertura.md (desbloqueo y reto)
 *
 * Antes la cookie de sesión ERA el valor de SESSION_SECRET. Si esa cookie se
 * filtraba (log, extensión de browser, backup), se filtraba el secreto del
 * servidor entero y no había forma de invalidar la sesión sin rotarlo.
 *
 * Ahora cada token es `<payload_base64url>.<firma>`, con expiración adentro del
 * payload. Filtrar la cookie solo compromete esa sesión hasta que expire; el
 * secreto nunca viaja al cliente.
 *
 * Hay tres tipos de token firmados con el mismo secreto, y el `tipo` va adentro
 * del payload firmado. Es lo que impide usar uno en lugar de otro: el endpoint
 * público que arranca el ingreso con passkey le entrega a cualquiera un token
 * de tipo `reto` recién firmado, y si la verificación de la sesión no mirara el
 * tipo, ese token alcanzaría para entrar.
 *
 * - `sesion`: 7 días. Con `bloqueo: true`, el dispositivo pide además un
 *   desbloqueo vigente (ver middleware.ts). Un token sin `tipo` (los de antes
 *   del ADR 0035) no vale como nada: aceptarlo dejaba abierta una puerta para
 *   cualquier otro payload firmado con este secreto.
 * - `desbloqueo`: pocos minutos; lo renueva el latido del dashboard mientras
 *   está a la vista (components/BloqueoFaceId.tsx).
 * - `reto`: el desafío de WebAuthn, para no guardarlo en el servidor.
 *
 * Usa WebCrypto (no `node:crypto`) porque este módulo lo importa también el
 * middleware, que corre en el Edge runtime.
 *
 * También vive acá `contrasenaHabilitada()`: el middleware y el login tienen
 * que estar de acuerdo en si la contraseña abre sesión, y los dos importan este
 * módulo. Ver docs/decisiones/0037-ingreso-solo-con-passkey.md
 */

export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 días, en segundos

/**
 * Cuánto dura un desbloqueo sin latido. Es el margen para volver a la app sin
 * pasar de nuevo por Face ID: el latido corre cada 30 s mientras la app está a
 * la vista, así que al salir el desbloqueo vence entre 90 y 120 s después.
 */
export const DESBLOQUEO_MAX_AGE = 120;

/** Tiempo para completar el diálogo de Face ID desde que se pidió el desafío. */
export const RETO_MAX_AGE = 120;

type Tipo = 'sesion' | 'desbloqueo' | 'reto';

interface Payload {
  sub: string; // usuario autenticado ('' en un reto)
  exp: number; // unix ts (segundos) de expiración
  tipo: Tipo;
  bloqueo?: boolean; // solo en sesiones
  reto?: string; // solo en retos: el desafío en base64url
}

export interface Sesion {
  sub: string;
  bloqueo: boolean;
}

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str: string): Uint8Array<ArrayBuffer> {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

const ahora = () => Math.floor(Date.now() / 1000);

async function firmar(payload: Payload, secret: string): Promise<string> {
  const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${b64urlEncode(new Uint8Array(sig))}`;
}

/**
 * Verifica la firma y que el token sea del tipo pedido; la expiración, salvo
 * que se pida ignorarla. Cualquier token malformado da null, igual que uno
 * inválido: no se distinguen los motivos hacia afuera.
 */
async function leer(
  token: string,
  secret: string,
  tipo: Tipo,
  ignorarExpiracion = false,
): Promise<Payload | null> {
  const idx = token.lastIndexOf('.');
  if (idx < 0) return null;
  const payloadB64 = token.slice(0, idx);
  const sigB64 = token.slice(idx + 1);

  try {
    const key = await hmacKey(secret);
    const sigOk = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(sigB64),
      new TextEncoder().encode(payloadB64),
    );
    if (!sigOk) return null;

    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as Payload;
    if (payload.tipo !== tipo) return null;
    if (typeof payload.exp !== 'number') return null;
    if (!ignorarExpiracion && payload.exp < ahora()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Política de ingreso ──────────────────────────────────────────────────────

/**
 * Si la contraseña abre sesión. En producción no, salvo `PERMITIR_CONTRASENA=true`:
 * ahí se entra solo con passkey, y la variable es la vía de recuperación si se
 * pierden todos los dispositivos (prenderla exige entrar a Vercel y redeployar).
 * Fuera de producción sí: las passkeys están atadas al dominio y una de
 * producción no sirve en localhost.
 * Ver docs/decisiones/0037-ingreso-solo-con-passkey.md
 */
export function contrasenaHabilitada(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.PERMITIR_CONTRASENA === 'true';
}

// ── Sesión ───────────────────────────────────────────────────────────────────

/** Firma un token de sesión para `user`, válido por SESSION_MAX_AGE. */
export async function crearToken(
  user: string,
  secret: string,
  { bloqueo = false }: { bloqueo?: boolean } = {},
): Promise<string> {
  const payload: Payload = { sub: user, exp: ahora() + SESSION_MAX_AGE, tipo: 'sesion' };
  if (bloqueo) payload.bloqueo = true;
  return firmar(payload, secret);
}

/**
 * Lee una sesión válida. Con `ignorarExpiracion`, devuelve también una vencida
 * con firma correcta: el login con contraseña la usa para saber si el
 * dispositivo tenía el bloqueo activado y conservarlo.
 */
export async function leerSesion(
  token: string,
  secret: string,
  { ignorarExpiracion = false }: { ignorarExpiracion?: boolean } = {},
): Promise<Sesion | null> {
  const p = await leer(token, secret, 'sesion', ignorarExpiracion);
  if (!p || typeof p.sub !== 'string' || !p.sub) return null;
  return { sub: p.sub, bloqueo: p.bloqueo === true };
}

/** Verifica firma, tipo y expiración. Devuelve el usuario si es válido, o null. */
export async function verificarToken(token: string, secret: string): Promise<string | null> {
  return (await leerSesion(token, secret))?.sub ?? null;
}

// ── Desbloqueo ───────────────────────────────────────────────────────────────

export async function crearTokenDesbloqueo(user: string, secret: string): Promise<string> {
  return firmar({ sub: user, exp: ahora() + DESBLOQUEO_MAX_AGE, tipo: 'desbloqueo' }, secret);
}

/** Devuelve el usuario desbloqueado, o null si el token no vale o venció. */
export async function verificarDesbloqueo(token: string, secret: string): Promise<string | null> {
  const p = await leer(token, secret, 'desbloqueo');
  return p && typeof p.sub === 'string' && p.sub ? p.sub : null;
}

// ── Reto de WebAuthn ─────────────────────────────────────────────────────────

/** Genera un desafío nuevo y lo devuelve junto con su token firmado. */
export async function crearReto(secret: string): Promise<{ reto: string; token: string }> {
  const reto = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const token = await firmar({ sub: '', exp: ahora() + RETO_MAX_AGE, tipo: 'reto', reto }, secret);
  return { reto, token };
}

/** Devuelve el desafío firmado en el token, o null si no vale o venció. */
export async function verificarReto(token: string, secret: string): Promise<string | null> {
  const p = await leer(token, secret, 'reto');
  return p && typeof p.reto === 'string' && p.reto ? p.reto : null;
}
