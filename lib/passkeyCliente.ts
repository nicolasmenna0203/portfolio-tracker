/**
 * Ceremonias de passkey del lado del navegador: arman las opciones de WebAuthn
 * con lo que manda el servidor y le devuelven la respuesta en base64url.
 * La verificación está en lib/webauthn.ts; la decisión en
 * docs/decisiones/0035-bloqueo-con-passkey-en-cada-apertura.md
 */

import { b64urlDecode, b64urlEncode } from './session';

const enB64 = (buf: ArrayBuffer | null | undefined) => (buf ? b64urlEncode(new Uint8Array(buf)) : '');

/** Hay autenticador del dispositivo con verificación (Face ID, Touch ID, Windows Hello). */
export async function hayFaceId(): Promise<boolean> {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.PublicKeyCredential !== 'undefined' &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

/** El usuario cerró el diálogo o el sistema no dejó abrirlo sin un toque. */
export function esCancelacion(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError');
}

async function errorDe(res: Response, porDefecto: string): Promise<Error> {
  try {
    const data = (await res.json()) as { error?: string };
    return new Error(data.error ?? porDefecto);
  } catch {
    return new Error(porDefecto);
  }
}

// ── Recordar que este dispositivo usa Face ID ──────────────────────────────
// Para intentar Face ID solo al abrir el login aunque no se venga de un
// bloqueo (p. ej. venció la sesión de 7 días). Es una preferencia del
// navegador, no seguridad: si se pierde, queda el botón.
const CLAVE_RECORDAR = 'faceid_v1';

export function recordarFaceId(): void {
  try { localStorage.setItem(CLAVE_RECORDAR, '1'); } catch { /* sin storage: queda el botón */ }
}

export function usaFaceId(): boolean {
  try { return localStorage.getItem(CLAVE_RECORDAR) === '1'; } catch { return false; }
}

// ── Ingreso ──────────────────────────────────────────────────────────────────

export interface OpcionesAcceso {
  reto: string;
  rpId: string;
  pedidas: number;
}

/** El reto firmado dura 2 minutos (RETO_MAX_AGE): pasado 1,5 se pide otro. */
const VIGENCIA_OPCIONES_MS = 90_000;

/**
 * Pide el desafío por adelantado. Así, al tocar, `credentials.get` se llama sin
 * esperar la red: Safari exige que Face ID salga de un toque, y una espera
 * larga entre el toque y la llamada puede hacer que ya no cuente como tal.
 */
export async function pedirOpcionesAcceso(): Promise<OpcionesAcceso> {
  const res = await fetch('/api/auth/passkey/acceso', { cache: 'no-store' });
  if (!res.ok) throw await errorDe(res, 'No se pudo iniciar Face ID');
  const { reto, rpId } = (await res.json()) as { reto: string; rpId: string };
  return { reto, rpId, pedidas: Date.now() };
}

/**
 * Ingreso o desbloqueo con passkey. Resuelve si el servidor abrió la sesión.
 * Con `opciones` pedidas hace poco, no toca la red antes de abrir Face ID.
 */
export async function accederConPasskey(opciones?: OpcionesAcceso | null): Promise<void> {
  const { reto, rpId } =
    opciones && Date.now() - opciones.pedidas < VIGENCIA_OPCIONES_MS ? opciones : await pedirOpcionesAcceso();

  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: b64urlDecode(reto),
      rpId,
      userVerification: 'required',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('No se eligió ninguna passkey');

  const r = cred.response as AuthenticatorAssertionResponse;
  const res = await fetch('/api/auth/passkey/acceso', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: enB64(cred.rawId),
      clientDataJSON: enB64(r.clientDataJSON),
      authenticatorData: enB64(r.authenticatorData),
      signature: enB64(r.signature),
    }),
  });
  if (!res.ok) throw await errorDe(res, 'Face ID no coincide con una passkey registrada');
  recordarFaceId();
}

/** Alta de una passkey en este dispositivo. Requiere sesión abierta. */
export async function registrarPasskey(): Promise<void> {
  const opcionesRes = await fetch('/api/auth/passkey/registro', { cache: 'no-store' });
  if (!opcionesRes.ok) throw await errorDe(opcionesRes, 'No se pudo iniciar el registro');
  const o = (await opcionesRes.json()) as {
    reto: string;
    rp: { name: string; id: string };
    user: { id: string; name: string; displayName: string };
    alg: number;
    excluir: string[];
  };

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: b64urlDecode(o.reto),
      rp: o.rp,
      user: { ...o.user, id: b64urlDecode(o.user.id) },
      pubKeyCredParams: [{ type: 'public-key', alg: o.alg }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      excludeCredentials: o.excluir.map((id) => ({ type: 'public-key' as const, id: b64urlDecode(id) })),
      attestation: 'none',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('No se creó la passkey');

  const r = cred.response as AuthenticatorAttestationResponse;
  // getPublicKey y getAuthenticatorData existen desde iOS 16 / Safari 16.
  if (typeof r.getPublicKey !== 'function' || typeof r.getAuthenticatorData !== 'function') {
    throw new Error('Este navegador no permite registrar la passkey: actualizá el sistema');
  }
  const publicKey = r.getPublicKey();
  if (!publicKey) throw new Error('El dispositivo creó una passkey con un algoritmo no soportado');

  const res = await fetch('/api/auth/passkey/registro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: enB64(cred.rawId),
      clientDataJSON: enB64(r.clientDataJSON),
      authenticatorData: enB64(r.getAuthenticatorData()),
      publicKey: enB64(publicKey),
      publicKeyAlgorithm: r.getPublicKeyAlgorithm(),
    }),
  });
  if (!res.ok) throw await errorDe(res, 'No se pudo guardar la passkey');
  recordarFaceId();
}
