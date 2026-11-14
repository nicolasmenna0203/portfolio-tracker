import { describe, it, expect, vi, afterEach } from 'vitest';
import { nombreDispositivo, datosDelPedido, armarAviso, avisarSeguridad } from './avisoSeguridad';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const pedido = (h: Record<string, string>) => ({ headers: new Headers(h) });

describe('nombreDispositivo', () => {
  it('saca el dispositivo del user agent', () => {
    expect(nombreDispositivo('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone');
    expect(nombreDispositivo('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('Mac');
    expect(nombreDispositivo('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
    expect(nombreDispositivo('')).toBe('Otro');
  });
});

describe('datosDelPedido', () => {
  it('toma la primera IP de x-forwarded-for y el lugar de los headers de Vercel', () => {
    const cuando = new Date('2026-01-02T15:00:00Z');
    const d = datosDelPedido(pedido({
      'x-forwarded-for': '203.0.113.7, 10.0.0.1',
      'x-vercel-ip-city': 'Villa%20Ficticia',
      'x-vercel-ip-country': 'ZZ',
      'user-agent': 'Mozilla/5.0 (Linux; Android 15)',
    }), cuando);
    expect(d).toEqual({ ip: '203.0.113.7', lugar: 'Villa Ficticia, ZZ', dispositivo: 'Android', cuando });
  });

  it('sin headers, o con la ciudad mal codificada, no falla', () => {
    expect(datosDelPedido(pedido({}))).toMatchObject({ ip: 'desconocida', lugar: '', dispositivo: 'Otro' });
    expect(datosDelPedido(pedido({ 'x-vercel-ip-city': '%E0%A4%A' })).lugar).toBe('%E0%A4%A');
  });
});

describe('armarAviso', () => {
  const datos = { ip: '203.0.113.7', lugar: 'Villa Ficticia, ZZ', dispositivo: 'Mac', cuando: new Date('2026-01-02T15:00:00Z') };

  it('dice qué pasó, desde dónde y qué hacer si no fuiste vos', () => {
    const { asunto, texto } = armarAviso('passkey-registrada', datos);
    expect(asunto).toContain('passkey nueva');
    expect(texto).toContain('203.0.113.7 (Villa Ficticia, ZZ)');
    expect(texto).toContain('Mac');
    expect(texto).toContain('hoja Passkeys');
  });

  it('el ingreso con contraseña recuerda que solo funciona con la variable prendida', () => {
    expect(armarAviso('ingreso-con-contrasena', datos).texto).toContain('PERMITIR_CONTRASENA');
  });
});

describe('avisarSeguridad', () => {
  const datos = { ip: '203.0.113.7', lugar: '', dispositivo: 'Mac', cuando: new Date() };

  const enProduccion = () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALERTA_EMAIL', 'yo@example.com');
    vi.stubEnv('RESEND_API_KEY', 're_test');
  };

  it('fuera de producción no manda nada', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await avisarSeguridad('ingreso-con-contrasena', datos);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('en producción manda el mail a ALERTA_EMAIL', async () => {
    enProduccion();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await avisarSeguridad('passkey-registrada', datos);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).to).toEqual(['yo@example.com']);
  });

  it('si el mail falla no tira: un aviso caído no frena el ingreso', async () => {
    enProduccion();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin red')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(avisarSeguridad('passkey-registrada', datos)).resolves.toBeUndefined();
  });
});
