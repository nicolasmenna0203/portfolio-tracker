/**
 * Verificación de passkeys (WebAuthn) con WebCrypto, sin librería.
 *
 * Decisión y alternativas descartadas:
 * docs/decisiones/0035-bloqueo-con-passkey-en-cada-apertura.md
 *
 * Es la misma elección que en la sesión firmada (ADR 0014): para un solo
 * usuario y un solo algoritmo, las dos verificaciones que hacen falta entran en
 * este archivo y no justifican una dependencia.
 *
 * Lo que se acota a propósito:
 *
 * - **Solo ES256** (ECDSA P-256, `alg: -7`). Es lo que generan las passkeys de
 *   iCloud, Windows Hello y Android. Otro algoritmo se rechaza al registrar.
 * - **Sin attestation** (`attestation: 'none'`). No se verifica quién fabricó
 *   el autenticador: el registro solo se puede hacer con una sesión ya abierta
 *   (pasó por contraseña o por otra passkey), así que la clave pública que
 *   manda el navegador ya viene de alguien autenticado. Por eso tampoco se
 *   parsea el `attestationObject` en CBOR: la clave llega en SPKI con
 *   `getPublicKey()` y el `authenticatorData` con `getAuthenticatorData()`.
 * - **Sin contador de firmas.** Las passkeys sincronizadas por iCloud mandan
 *   siempre 0, así que no sirve para detectar clones.
 *
 * Lo que sí se exige en las dos ceremonias: el `type` correcto, el desafío que
 * firmó el servidor, el origen de la app, el hash del rpId en el
 * `authenticatorData`, y los flags de presencia (UP) y de verificación del
 * usuario (UV): UV es lo que garantiza que hubo Face ID y no solo un toque.
 */

import { b64urlDecode, b64urlEncode } from './session';

/** COSE: ECDSA con SHA-256 sobre P-256. */
export const ALG_ES256 = -7;

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export interface Esperado {
  /** El desafío firmado en la cookie de reto, en base64url. */
  reto: string;
  /** Origen de la app, p. ej. `https://dominio`. */
  origen: string;
  /** Hostname del origen: es el rpId con el que se registran las passkeys. */
  rpId: string;
}

export interface RespuestaRegistro {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  /** SPKI DER en base64url, de `getPublicKey()`. */
  publicKey: string;
  publicKeyAlgorithm: number;
}

export interface RespuestaAcceso {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  /** Firma ECDSA en DER, como la manda el autenticador. */
  signature: string;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; motivo: string };

const falla = (motivo: string): { ok: false; motivo: string } => ({ ok: false, motivo });

function iguales(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sha256(datos: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', datos));
}

function decodificar(b64: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof b64 !== 'string' || !b64) return null;
  try {
    return b64urlDecode(b64);
  } catch {
    return null;
  }
}

/** Chequea el clientDataJSON contra lo esperado. */
function verificarClientData(
  bytes: Uint8Array,
  tipo: 'webauthn.create' | 'webauthn.get',
  esperado: Esperado,
): string | null {
  let cd: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    cd = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return 'clientDataJSON ilegible';
  }
  if (cd.type !== tipo) return 'tipo de ceremonia incorrecto';
  if (cd.crossOrigin === true) return 'ceremonia desde un iframe de otro origen';
  if (cd.origin !== esperado.origen) return 'origen incorrecto';
  const reto = decodificar(cd.challenge);
  const retoEsperado = decodificar(esperado.reto);
  if (!reto || !retoEsperado || !iguales(reto, retoEsperado)) return 'desafío incorrecto';
  return null;
}

/** Chequea rpIdHash y flags del authenticatorData. Devuelve los flags o un motivo. */
async function verificarAuthData(
  authData: Uint8Array,
  rpId: string,
): Promise<{ flags: number } | string> {
  if (authData.length < 37) return 'authenticatorData demasiado corto';
  const rpIdHash = await sha256(new TextEncoder().encode(rpId));
  if (!iguales(authData.subarray(0, 32), rpIdHash)) return 'rpId incorrecto';
  const flags = authData[32];
  if (!(flags & FLAG_UP)) return 'sin presencia del usuario';
  if (!(flags & FLAG_UV)) return 'sin verificación del usuario (Face ID)';
  return { flags };
}

/**
 * Pasa una firma ECDSA de DER (`30 len 02 rlen r 02 slen s`) al formato crudo
 * `r || s` de 64 bytes que espera WebCrypto. Los enteros DER pueden venir con un
 * 0x00 adelante (si el bit alto está prendido) o más cortos que 32 bytes.
 */
export function derARaw(der: Uint8Array): Uint8Array<ArrayBuffer> | null {
  let i = 0;
  if (der[i++] !== 0x30) return null;
  let largo = der[i++];
  if (largo & 0x80) {
    // Largo en forma larga: con P-256 nunca pasa de 1 byte extra.
    const n = largo & 0x7f;
    if (n !== 1) return null;
    largo = der[i++];
  }
  if (largo !== der.length - i) return null;

  const out = new Uint8Array(new ArrayBuffer(64));
  for (const offset of [0, 32]) {
    if (der[i++] !== 0x02) return null;
    let len = der[i++];
    if (len === undefined || i + len > der.length) return null;
    let inicio = i;
    while (len > 32 && der[inicio] === 0) {
      inicio++;
      len--;
    }
    if (len > 32) return null;
    out.set(der.subarray(inicio, inicio + len), offset + 32 - len);
    i = inicio + len;
  }
  return i === der.length ? out : null;
}

function importarClave(spki: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

/**
 * Verifica el alta de una passkey. Devuelve el id y la clave pública (SPKI) en
 * base64url, listos para guardar.
 */
export async function verificarRegistro(
  r: RespuestaRegistro,
  esperado: Esperado,
): Promise<Resultado<{ id: string; clavePublica: string }>> {
  const id = decodificar(r?.id);
  const clientData = decodificar(r?.clientDataJSON);
  const authData = decodificar(r?.authenticatorData);
  const spki = decodificar(r?.publicKey);
  if (!id || !clientData || !authData || !spki) return falla('respuesta incompleta');
  if (r.publicKeyAlgorithm !== ALG_ES256) return falla('algoritmo no soportado');

  const errCd = verificarClientData(clientData, 'webauthn.create', esperado);
  if (errCd) return falla(errCd);

  const ad = await verificarAuthData(authData, esperado.rpId);
  if (typeof ad === 'string') return falla(ad);
  if (!(ad.flags & FLAG_AT)) return falla('sin datos de la credencial');

  // attestedCredentialData: aaguid (16) | largo del id (2) | id.
  const base = 37 + 16;
  if (authData.length < base + 2) return falla('authenticatorData demasiado corto');
  const largoId = (authData[base] << 8) | authData[base + 1];
  const idEnAuthData = authData.subarray(base + 2, base + 2 + largoId);
  if (!iguales(idEnAuthData, id)) return falla('el id no coincide con el del autenticador');

  try {
    await importarClave(spki);
  } catch {
    return falla('clave pública inválida');
  }

  return { ok: true, valor: { id: b64urlEncode(id), clavePublica: b64urlEncode(spki) } };
}

/**
 * Verifica un ingreso con passkey contra la clave pública guardada para ese id.
 * La firma cubre `authenticatorData || SHA-256(clientDataJSON)`.
 */
export async function verificarAcceso(
  r: RespuestaAcceso,
  clavePublica: string,
  esperado: Esperado,
): Promise<Resultado<null>> {
  const clientData = decodificar(r?.clientDataJSON);
  const authData = decodificar(r?.authenticatorData);
  const firmaDer = decodificar(r?.signature);
  const spki = decodificar(clavePublica);
  if (!clientData || !authData || !firmaDer || !spki) return falla('respuesta incompleta');

  const errCd = verificarClientData(clientData, 'webauthn.get', esperado);
  if (errCd) return falla(errCd);

  const ad = await verificarAuthData(authData, esperado.rpId);
  if (typeof ad === 'string') return falla(ad);

  const firma = derARaw(firmaDer);
  if (!firma) return falla('firma malformada');

  const hashCd = await sha256(clientData);
  const firmado = new Uint8Array(new ArrayBuffer(authData.length + hashCd.length));
  firmado.set(authData, 0);
  firmado.set(hashCd, authData.length);

  try {
    const clave = await importarClave(spki);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, clave, firma, firmado);
    return ok ? { ok: true, valor: null } : falla('firma inválida');
  } catch {
    return falla('clave pública inválida');
  }
}
