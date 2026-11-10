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

/** Ingreso o desbloqueo con passkey. Resuelve si el servidor abrió la sesión. */
export async function accederConPasskey(): Promise<void> {
  const opcionesRes = await fetch('/api/auth/passkey/acceso', { cache: 'no-store' });
  if (!opcionesRes.ok) throw await errorDe(opcionesRes, 'No se pudo iniciar Face ID');
  const { reto, rpId } = (await opcionesRes.json()) as { reto: string; rpId: string };

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
}
