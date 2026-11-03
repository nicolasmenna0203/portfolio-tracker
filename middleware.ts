import { NextRequest, NextResponse } from 'next/server';
import { verificarToken } from '@/lib/session';

// Corre en el Edge runtime: sin node:crypto. Por eso la sesión se firma con
// WebCrypto → docs/decisiones/0014-hmac-webcrypto-por-edge-runtime.md
//
// /api/alertas/semanal es pública acá porque la llama un cron externo sin
// cookie de sesión — se autentica sola con CRON_SECRET (ver su route.ts).
//
// /demo y /api/demo son públicas a propósito: sirven el dashboard con datos
// 100% sintéticos (lib/demo/) para que cualquiera que lea el repo público
// pueda ver la app funcionando sin login ni acceso a la cartera real.
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/alertas/semanal', '/demo', '/api/demo'];

// DEMO_ONLY marca el deploy de Vercel separado que solo sirve /demo (dominio
// propio, sin relación con el sitio real, sin BASIC_AUTH_USER/PASS ni
// SESSION_SECRET configurados a propósito — el login ahí siempre falla).
// Con la variable seteada, cualquier ruta fuera de /demo redirige a /demo en
// vez de a /login, para no mostrar una pantalla de login que nunca deja
// entrar a nadie.
const DEMO_ONLY = process.env.DEMO_ONLY === 'true';

// La exclusión de _next/static, _next/image, favicon.ico, icon.svg y
// apple-icon.png ya está en el `matcher` de abajo (Next ni siquiera invoca
// este middleware para esas rutas). Se repite acá a propósito, no por
// descuido: si algún día cambia el matcher, este chequeo interno sigue
// protegiendo esas rutas igual.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // En DEMO_ONLY, todo lo que no sea /demo o /api/demo (incluido /login, que
  // de otra forma seguiría siendo público y mostraría un formulario que nunca
  // deja pasar a nadie) va directo a /demo.
  if (DEMO_ONLY) {
    const esDemo = pathname.startsWith('/demo') || pathname.startsWith('/api/demo');
    if (esDemo) return NextResponse.next();
    const demoUrl = req.nextUrl.clone();
    demoUrl.pathname = '/demo';
    return NextResponse.redirect(demoUrl);
  }

  const isPublic =
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next/static') ||
    pathname.startsWith('/_next/image') ||
    pathname === '/favicon.ico' ||
    pathname === '/icon.svg' ||
    pathname === '/apple-icon.png';

  if (isPublic) return NextResponse.next();

  const session = req.cookies.get('session')?.value;
  const secret = process.env.SESSION_SECRET;

  if (session && secret && (await verificarToken(session, secret))) {
    return NextResponse.next();
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png).*)'],
};