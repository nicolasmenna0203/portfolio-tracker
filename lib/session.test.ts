import { describe, it, expect, vi, afterEach } from 'vitest';
import { crearToken, verificarToken, SESSION_MAX_AGE } from './session';

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
