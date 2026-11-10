import { describe, it, expect, beforeAll } from 'vitest';
import {
  verificarRegistro, verificarAcceso, derARaw, ALG_ES256,
  type Esperado, type RespuestaRegistro, type RespuestaAcceso,
} from './webauthn';
import { b64urlEncode } from './session';

// Fixtures sintéticos: un "autenticador" armado con WebCrypto que produce las
// mismas estructuras que un iPhone (authenticatorData, clientDataJSON, firma
// ECDSA en DER), con un dominio y un desafío inventados.

const ESPERADO: Esperado = {
  reto: b64urlEncode(new Uint8Array(32).fill(7)),
  origen: 'https://cartera.example.com',
  rpId: 'cartera.example.com',
};

const ID = new Uint8Array(16).map((_, i) => i + 1);

let claves: CryptoKeyPair;
let spki: string;

beforeAll(async () => {
  claves = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  spki = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('spki', claves.publicKey)));
});

const concat = (...partes: Uint8Array[]) => {
  const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
};

async function authData(flags: number, { rpId = ESPERADO.rpId, credId }: { rpId?: string; credId?: Uint8Array } = {}) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId)));
  const base = concat(hash, new Uint8Array([flags]), new Uint8Array(4));
  if (!credId) return base;
  // aaguid en cero | largo del id | id | (clave COSE: no se parsea, va basura)
  return concat(base, new Uint8Array(16), new Uint8Array([0, credId.length]), credId, new Uint8Array([0xa5, 1, 2]));
}

function clientData(type: string, { reto = ESPERADO.reto, origen = ESPERADO.origen } = {}) {
  return new TextEncoder().encode(JSON.stringify({ type, challenge: reto, origin: origen, crossOrigin: false }));
}

/** r||s crudo → DER, como lo manda un autenticador. */
function rawADer(raw: Uint8Array): Uint8Array {
  const entero = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v = b.subarray(i);
    if (v[0] & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const cuerpo = concat(entero(raw.subarray(0, 32)), entero(raw.subarray(32)));
  return concat(new Uint8Array([0x30, cuerpo.length]), cuerpo);
}

async function asercion(opts: { flags?: number; rpId?: string; type?: string; reto?: string; origen?: string } = {}): Promise<RespuestaAcceso> {
  const ad = await authData(opts.flags ?? 0x05, { rpId: opts.rpId });
  const cd = clientData(opts.type ?? 'webauthn.get', { reto: opts.reto, origen: opts.origen });
  const hashCd = new Uint8Array(await crypto.subtle.digest('SHA-256', cd));
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, claves.privateKey, concat(ad, hashCd)));
  return {
    id: b64urlEncode(ID),
    clientDataJSON: b64urlEncode(cd),
    authenticatorData: b64urlEncode(ad),
    signature: b64urlEncode(rawADer(raw)),
  };
}

async function registro(opts: { flags?: number; credId?: Uint8Array; type?: string } = {}): Promise<RespuestaRegistro> {
  return {
    id: b64urlEncode(ID),
    clientDataJSON: b64urlEncode(clientData(opts.type ?? 'webauthn.create')),
    authenticatorData: b64urlEncode(await authData(opts.flags ?? 0x45, { credId: opts.credId ?? ID })),
    publicKey: spki,
    publicKeyAlgorithm: ALG_ES256,
  };
}

describe('derARaw', () => {
  it('ida y vuelta con enteros cortos y con el bit alto prendido', () => {
    const casos = [
      new Uint8Array(64).fill(0xff), // los dos con 0x00 adelante en DER
      concat(new Uint8Array(31), new Uint8Array([5]), new Uint8Array(32).fill(1)), // r de 1 byte
    ];
    for (const raw of casos) expect(derARaw(rawADer(raw))).toEqual(raw);
  });

  it('rechaza estructuras que no son una firma DER', () => {
    expect(derARaw(new Uint8Array([0x31, 0]))).toBeNull();
    expect(derARaw(new Uint8Array([0x30, 5, 2, 1, 1]))).toBeNull();
    expect(derARaw(new Uint8Array([]))).toBeNull();
  });
});

describe('verificarAcceso', () => {
  it('acepta una aserción bien firmada con UP y UV', async () => {
    expect(await verificarAcceso(await asercion(), spki, ESPERADO)).toEqual({ ok: true, valor: null });
  });

  it('rechaza sin verificación del usuario (UV): un toque sin Face ID no alcanza', async () => {
    const r = await verificarAcceso(await asercion({ flags: 0x01 }), spki, ESPERADO);
    expect(r.ok).toBe(false);
  });

  it('rechaza otro origen, otro rpId, otro desafío y otro tipo de ceremonia', async () => {
    for (const opts of [
      { origen: 'https://phishing.example.net' },
      { rpId: 'phishing.example.net' },
      { reto: b64urlEncode(new Uint8Array(32).fill(8)) },
      { type: 'webauthn.create' },
    ]) {
      expect((await verificarAcceso(await asercion(opts), spki, ESPERADO)).ok).toBe(false);
    }
  });

  it('rechaza una firma de otra clave', async () => {
    const otra = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const otraSpki = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('spki', otra.publicKey)));
    expect((await verificarAcceso(await asercion(), otraSpki, ESPERADO)).ok).toBe(false);
  });

  it('rechaza authenticatorData alterado después de firmar', async () => {
    const a = await asercion();
    const ad = Buffer.from(a.authenticatorData, 'base64url');
    ad[33] ^= 1; // contador
    expect((await verificarAcceso({ ...a, authenticatorData: ad.toString('base64url') }, spki, ESPERADO)).ok).toBe(false);
  });

  it('rechaza respuestas incompletas o basura sin tirar excepción', async () => {
    expect((await verificarAcceso({} as RespuestaAcceso, spki, ESPERADO)).ok).toBe(false);
    expect((await verificarAcceso({ ...(await asercion()), signature: '!!!' }, spki, ESPERADO)).ok).toBe(false);
    expect((await verificarAcceso(await asercion(), 'no-es-una-clave', ESPERADO)).ok).toBe(false);
  });
});

describe('verificarRegistro', () => {
  it('acepta un alta válida y devuelve id y clave en base64url', async () => {
    const r = await verificarRegistro(await registro(), ESPERADO);
    expect(r).toEqual({ ok: true, valor: { id: b64urlEncode(ID), clavePublica: spki } });
  });

  it('rechaza si el id no coincide con el del authenticatorData', async () => {
    const r = await verificarRegistro(await registro({ credId: new Uint8Array(16).fill(9) }), ESPERADO);
    expect(r.ok).toBe(false);
  });

  it('rechaza sin UV, sin datos de credencial o con tipo de ceremonia de ingreso', async () => {
    for (const opts of [{ flags: 0x41 }, { flags: 0x05 }, { type: 'webauthn.get' }]) {
      expect((await verificarRegistro(await registro(opts), ESPERADO)).ok).toBe(false);
    }
  });

  it('rechaza un algoritmo que no sea ES256', async () => {
    const r = await verificarRegistro({ ...(await registro()), publicKeyAlgorithm: -257 }, ESPERADO);
    expect(r.ok).toBe(false);
  });
});
