import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  crearToken, verificarToken, leerSesion, SESSION_MAX_AGE,
  crearTokenDesbloqueo, verificarDesbloqueo, DESBLOQUEO_MAX_AGE,
  crearReto, verificarReto,
} from './session';

const SECRET = 'un-secreto-de-test-bien-largo';

afterEach(() => {
  vi.useRealTimers();
});

describe('crearToken / verificarToken', () => {
  it('un token recién creado verifica OK y devuelve el usuario', async () => {
    const token = await crearToken('nm', SECRET);
    expect(await verificarToken(token, SECRET)).toBe('nm');
  });

  it('rechaza el token si se verifica con otro secreto', async () => {
    const token = await crearToken('nm', SECRET);
    expect(await verificarToken(token, 'otro-secreto')).toBeNull();
  });

  it('rechaza un token con la firma alterada', async () => {
    const token = await crearToken('nm', SECRET);
    const [payload, sig] = token.split('.');
    // El primer carácter y no el último: 32 bytes son 43 caracteres base64 y el
    // último lleva 2 bits que el decoder ignora. Una firma que terminaba en "Y"
    // pasaba a "a" con los mismos bytes, y el test fallaba 1 de cada 16 veces.
    const tampered = `${payload}.${sig[0] === 'a' ? 'b' : 'a'}${sig.slice(1)}`;
    expect(await verificarToken(tampered, SECRET)).toBeNull();
  });

  it('rechaza un bit cambiado en cualquier byte de la firma', async () => {
    const token = await crearToken('nm', SECRET);
    const [payload, sig] = token.split('.');
    const original = Buffer.from(sig, 'base64url');
    expect(original.length).toBe(32);
    for (let i = 0; i < original.length; i++) {
      const alterada = Buffer.from(original);
      alterada[i] ^= 1;
      expect(await verificarToken(`${payload}.${alterada.toString('base64url')}`, SECRET)).toBeNull();
    }
  });

  it('rechaza un token con el payload alterado (mismo secreto, firma vieja)', async () => {
    const tokenAdmin = await crearToken('admin', SECRET);
    const tokenUser = await crearToken('nm', SECRET);
    const [, sigAdmin] = tokenAdmin.split('.');
    const [payloadUser] = tokenUser.split('.');
    // Intento de Frankenstein: payload de un usuario + firma de otro.
    expect(await verificarToken(`${payloadUser}.${sigAdmin}`, SECRET)).toBeNull();
  });

  it('rechaza tokens malformados sin tirar excepción', async () => {
    expect(await verificarToken('', SECRET)).toBeNull();
    expect(await verificarToken('sin-punto', SECRET)).toBeNull();
    expect(await verificarToken('a.b.c', SECRET)).toBeNull();
    expect(await verificarToken('!!!.!!!', SECRET)).toBeNull();
  });

  it('expira pasado SESSION_MAX_AGE', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 0, 1));

    const token = await crearToken('nm', SECRET);
    expect(await verificarToken(token, SECRET)).toBe('nm');

    // Un segundo antes de expirar: todavía válido.
    vi.setSystemTime(Date.UTC(2026, 0, 1) + SESSION_MAX_AGE * 1000 - 1000);
    expect(await verificarToken(token, SECRET)).toBe('nm');

    // Un segundo después: ya no.
    vi.setSystemTime(Date.UTC(2026, 0, 1) + SESSION_MAX_AGE * 1000 + 1000);
    expect(await verificarToken(token, SECRET)).toBeNull();
  });
});

// ── Tipos de token (ADR 0035) ────────────────────────────────────────────────
// Los tres tipos se firman con el mismo secreto. Si la verificación de uno no
// mirara el tipo, un reto (que el endpoint público de passkey le firma a
// cualquiera) o un desbloqueo alcanzarían para entrar como sesión.
describe('tipos de token', () => {
  it('un reto no vale como sesión ni como desbloqueo', async () => {
    const { token } = await crearReto(SECRET);
    expect(await verificarToken(token, SECRET)).toBeNull();
    expect(await leerSesion(token, SECRET)).toBeNull();
    expect(await verificarDesbloqueo(token, SECRET)).toBeNull();
  });

  it('un desbloqueo no vale como sesión ni como reto', async () => {
    const token = await crearTokenDesbloqueo('nm', SECRET);
    expect(await verificarToken(token, SECRET)).toBeNull();
    expect(await verificarReto(token, SECRET)).toBeNull();
    expect(await verificarDesbloqueo(token, SECRET)).toBe('nm');
  });

  it('una sesión no vale como desbloqueo', async () => {
    const token = await crearToken('nm', SECRET, { bloqueo: true });
    expect(await verificarDesbloqueo(token, SECRET)).toBeNull();
  });

  it('el reto devuelve el desafío que firmó', async () => {
    const { reto, token } = await crearReto(SECRET);
    expect(reto).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await verificarReto(token, SECRET)).toBe(reto);
    expect(await verificarReto(token, 'otro-secreto')).toBeNull();
  });

  it('una sesión anterior al campo tipo sigue valiendo, sin bloqueo', async () => {
    // Así eran los tokens antes del ADR 0035: { sub, exp }, sin tipo.
    const payload = Buffer.from(JSON.stringify({ sub: 'nm', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64url');
    expect(await leerSesion(`${payload}.${sig}`, SECRET)).toEqual({ sub: 'nm', bloqueo: false });
  });

  it('la sesión lleva la marca de bloqueo firmada', async () => {
    expect(await leerSesion(await crearToken('nm', SECRET, { bloqueo: true }), SECRET)).toEqual({ sub: 'nm', bloqueo: true });
    expect(await leerSesion(await crearToken('nm', SECRET), SECRET)).toEqual({ sub: 'nm', bloqueo: false });
  });

  it('con ignorarExpiracion lee una sesión vencida, pero no una con firma mala', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 0, 1));
    const token = await crearToken('nm', SECRET, { bloqueo: true });
    vi.setSystemTime(Date.UTC(2026, 0, 1) + SESSION_MAX_AGE * 1000 + 1000);

    expect(await leerSesion(token, SECRET)).toBeNull();
    expect(await leerSesion(token, SECRET, { ignorarExpiracion: true })).toEqual({ sub: 'nm', bloqueo: true });
    expect(await leerSesion(token, 'otro-secreto', { ignorarExpiracion: true })).toBeNull();
  });

  it('el desbloqueo vence pasado DESBLOQUEO_MAX_AGE', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 0, 1));
    const token = await crearTokenDesbloqueo('nm', SECRET);
    vi.setSystemTime(Date.UTC(2026, 0, 1) + DESBLOQUEO_MAX_AGE * 1000 - 1000);
    expect(await verificarDesbloqueo(token, SECRET)).toBe('nm');
    vi.setSystemTime(Date.UTC(2026, 0, 1) + DESBLOQUEO_MAX_AGE * 1000 + 1000);
    expect(await verificarDesbloqueo(token, SECRET)).toBeNull();
  });
});
