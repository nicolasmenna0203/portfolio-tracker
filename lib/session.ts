/**
 * Token de sesión firmado (HMAC-SHA256), no el secreto en texto plano.
 *
 * Decisión y alternativas descartadas:
 * docs/decisiones/0014-hmac-webcrypto-por-edge-runtime.md
 *
 * Antes la cookie de sesión ERA el valor de SESSION_SECRET. Si esa cookie se
 * filtraba (log, extensión de browser, backup), se filtraba el secreto del
 * servidor entero y no había forma de invalidar la sesión sin rotarlo.
 *
 * Ahora la cookie es `<payload_base64url>.<firma>`, con expiración adentro del
 * payload. Filtrar la cookie solo compromete esa sesión hasta que expire; el
 * secreto nunca viaja al cliente.
 *
 * Usa WebCrypto (no `node:crypto`) porque este módulo lo importa también el
 * middleware, que corre en el Edge runtime.
 */

export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 días, en segundos

interface Payload {
  sub: string; // usuario autenticado
  exp: number; // unix ts (segundos) de expiración
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Uint8Array<ArrayBuffer> {
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

/** Firma un token de sesión para `user`, válido por SESSION_MAX_AGE. */
export async function crearToken(user: string, secret: string): Promise<string> {
  const payload: Payload = { sub: user, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE };
  const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));

  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const sigB64 = b64urlEncode(new Uint8Array(sig));

  return `${payloadB64}.${sigB64}`;
}

/** Verifica firma y expiración. Devuelve el usuario si es válido, o null. */
export async function verificarToken(token: string, secret: string): Promise<string | null> {
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
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub ?? null;
  } catch {
    // Token malformado (base64 inválido, JSON roto, etc.) — mismo resultado que inválido.
    return null;
  }
}
