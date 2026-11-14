import { NextRequest, NextResponse } from 'next/server';
import { leerSesion, verificarDesbloqueo, contrasenaHabilitada } from '@/lib/session';
import { COOKIE_SESION, COOKIE_DESBLOQUEO, COOKIE_OCULTA } from '@/lib/cookiesAuth';

// Corre en el Edge runtime: sin node:crypto. Por eso la sesión se firma con
// WebCrypto → docs/decisiones/0014-hmac-webcrypto-por-edge-runtime.md
//
// /api/alertas/semanal es pública acá porque la llama un cron externo sin
// cookie de sesión — se autentica sola con CRON_SECRET (ver su route.ts).
//
// /api/auth/passkey/acceso es pública porque es el ingreso con Face ID: se
// autentica con la firma de la passkey. El alta (/api/auth/passkey/registro)
// no lo es: pide sesión.
//
// /demo y /api/demo son públicas a propósito: sirven el dashboard con datos
// 100% sintéticos (lib/demo/) para que cualquiera que lea el repo público
// pueda ver la app funcionando sin login ni acceso a la cartera real.
//
// Cada entrada cubre la ruta exacta y lo que cuelga de ella (`/demo/...`), no
// cualquier ruta que empiece igual: con un `startsWith` a secas, `/demo`
// abriría también una futura `/demografia`.
const PUBLIC_PATHS = [
  '/login', '/api/auth/login', '/api/auth/passkey/acceso', '/api/alertas/semanal', '/demo', '/api/demo',
];

const cuelgaDe = (pathname: string, p: string) => pathname === p || pathname.startsWith(`${p}/`);

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
    const esDemo = cuelgaDe(pathname, '/demo') || cuelgaDe(pathname, '/api/demo');
    if (esDemo) return NextResponse.next();
    const demoUrl = req.nextUrl.clone();
    demoUrl.pathname = '/demo';
    return NextResponse.redirect(demoUrl);
  }

  const isPublic =
    PUBLIC_PATHS.some((p) => cuelgaDe(pathname, p)) ||
    pathname.startsWith('/_next/static') ||
    pathname.startsWith('/_next/image') ||
    pathname === '/favicon.ico' ||
    pathname === '/icon.svg' ||
    pathname === '/apple-icon.png';

  if (isPublic) return NextResponse.next();

  const token = req.cookies.get(COOKIE_SESION)?.value;
  const secret = process.env.SESSION_SECRET;
  const sesion = token && secret ? await leerSesion(token, secret) : null;

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = '';

  // Con la contraseña apagada (producción, ADR 0037) toda sesión válida viene
  // de una passkey y lleva bloqueo. Una sin bloqueo es de antes del cambio o de
  // cuando la contraseña estaba prendida para recuperar el acceso: no vale.
  // Ver docs/decisiones/0037-ingreso-solo-con-passkey.md
  if (!sesion || (!sesion.bloqueo && !contrasenaHabilitada())) {
    return NextResponse.redirect(loginUrl);
  }

  // Dispositivo con bloqueo (entró o se registró con Face ID): además de la
  // sesión hace falta un desbloqueo vigente, que dura minutos y solo renueva el
  // latido del dashboard mientras está a la vista. Al volver a abrir la app ya
  // venció, y se pide Face ID de nuevo. Antes que eso, la marca `app_oculta`
  // que pone el cliente al irse al fondo bloquea apenas se vuelve: el
  // vencimiento queda como respaldo si la marca no se llegó a poner.
  // Ver docs/decisiones/0035-bloqueo-con-passkey-en-cada-apertura.md y
  // docs/decisiones/0036-bloquear-al-salir-con-una-marca-del-cliente.md
  if (sesion.bloqueo) {
    const desbloqueo = req.cookies.get(COOKIE_DESBLOQUEO)?.value;
    const desbloqueado = desbloqueo ? await verificarDesbloqueo(desbloqueo, secret!) : null;
    const oculta = req.cookies.has(COOKIE_OCULTA);
    if (desbloqueado !== sesion.sub || oculta) {
      // Una API no redirige: el fetch seguiría la redirección y recibiría el
      // HTML del login con status 200, que el cliente no distingue de un dato.
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'bloqueado' }, { status: 401 });
      }
      loginUrl.searchParams.set('bloqueado', '1');
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png).*)'],
};