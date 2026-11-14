import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { crearToken, crearTokenDesbloqueo } from './session';
import { COOKIE_SESION, COOKIE_DESBLOQUEO, COOKIE_OCULTA } from './cookiesAuth';

const SECRET = 'un-secreto-de-test-bien-largo';

beforeEach(() => vi.stubEnv('SESSION_SECRET', SECRET));
afterEach(() => vi.unstubAllEnvs());

function pedido(ruta: string, cookies: Record<string, string> = {}) {
  const req = new NextRequest(new URL(ruta, 'https://cartera.example.com'));
  for (const [k, v] of Object.entries(cookies)) req.cookies.set(k, v);
  return req;
}

const pasa = (res: Response) => res.headers.get('x-middleware-next') === '1';
const destino = (res: Response) => new URL(res.headers.get('location') ?? 'https://x.invalid/');
const aLogin = (res: Response) => res.status === 307 && destino(res).pathname === '/login';

describe('rutas públicas', () => {
  it('abren la ruta exacta y lo que cuelga de ella', async () => {
    for (const ruta of ['/login', '/demo', '/demo/bonos', '/api/demo/fx', '/api/auth/passkey/acceso']) {
      expect(pasa(await middleware(pedido(ruta))), ruta).toBe(true);
    }
  });

  it('no abren otra ruta que solo empiece igual', async () => {
    for (const ruta of ['/demografia', '/api/demos', '/login-historial', '/api/auth/loginx']) {
      expect(aLogin(await middleware(pedido(ruta))), ruta).toBe(true);
    }
  });
});

describe('sesión', () => {
  it('sin sesión, al login', async () => {
    expect(aLogin(await middleware(pedido('/')))).toBe(true);
  });

  it('en producción, una sesión sin bloqueo (de contraseña) no vale', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const session = await crearToken('nm', SECRET);
    expect(aLogin(await middleware(pedido('/', { [COOKIE_SESION]: session })))).toBe(true);
  });

  it('con PERMITIR_CONTRASENA=true o fuera de producción, sí vale', async () => {
    const session = await crearToken('nm', SECRET);
    vi.stubEnv('NODE_ENV', 'development');
    expect(pasa(await middleware(pedido('/', { [COOKIE_SESION]: session })))).toBe(true);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PERMITIR_CONTRASENA', 'true');
    expect(pasa(await middleware(pedido('/', { [COOKIE_SESION]: session })))).toBe(true);
  });

  it('en producción, una sesión de passkey con desbloqueo vigente pasa', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const cookies = {
      [COOKIE_SESION]: await crearToken('nm', SECRET, { bloqueo: true }),
      [COOKIE_DESBLOQUEO]: await crearTokenDesbloqueo('nm', SECRET),
    };
    expect(pasa(await middleware(pedido('/', cookies)))).toBe(true);
  });

  it('sin desbloqueo, o con la marca de app oculta, bloquea; las APIs responden 401', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const session = await crearToken('nm', SECRET, { bloqueo: true });

    const sinDesbloqueo = await middleware(pedido('/', { [COOKIE_SESION]: session }));
    expect(aLogin(sinDesbloqueo)).toBe(true);
    expect(destino(sinDesbloqueo).searchParams.get('bloqueado')).toBe('1');

    const oculta = {
      [COOKIE_SESION]: session,
      [COOKIE_DESBLOQUEO]: await crearTokenDesbloqueo('nm', SECRET),
      [COOKIE_OCULTA]: '1',
    };
    expect((await middleware(pedido('/api/fx', oculta))).status).toBe(401);
  });
});
