import type { NextConfig } from 'next';

// Decisión y alternativas descartadas: docs/decisiones/0010-webpack-cache-en-memoria-por-onedrive.md
//
// NOTA sobre OneDrive: el proyecto vive dentro de OneDrive, que sincroniza y bloquea
// archivos de .next mientras Next los escribe, corrompiendo el build en dev (ENOENT
// al renombrar manifests y .pack.gz, "Cannot find module './NNN.js'").
//
// Mover el build con `distDir` NO es una solución viable:
//   - Con ruta absoluta (os.tmpdir()), Next la concatena a la raíz del proyecto y
//     genera "C:\...\PROYECTO\C:\Users\...\Temp\..." → ENOENT al arrancar.
//   - Con ruta relativa fuera del proyecto ('../../../...'), el build queda fuera del
//     árbol de node_modules y falla con "Cannot find module 'react/jsx-runtime'".
//
// Mitigación que sí funciona con distDir en .next: pasar el cache de webpack a
// memoria en desarrollo. Los .pack.gz del filesystem cache son lo que OneDrive
// renombra por detrás; sin ese cache en disco, desaparece la fuente de ENOENT.
// (Levemente más lento en recompilaciones, pero estable.) En Vercel no aplica.
// Si aun así reaparece: pausar la sincronización de OneDrive o mover el repo fuera.

// Headers de seguridad para todas las rutas.
//
// El dashboard tiene acciones que escriben en el Sheet (gastos, objetivos,
// uploads): si otro sitio pudiera embeberlo en un iframe, podría inducir clics
// sobre esas acciones (clickjacking). `frame-ancestors 'none'` es la defensa
// moderna; `X-Frame-Options` queda por browsers viejos.
//
// La CSP es mínima a propósito: no restringe `script-src` ni `style-src`
// porque Next inyecta scripts inline de hidratación y Recharts usa estilos
// inline. Una CSP estricta exige nonces generados en el middleware por request,
// y eso queda para cuando haga falta. Lo que sí se fija no rompe nada:
// quién puede embeber la página, a dónde se pueden mandar formularios, y que no
// se carguen plugins (`object-src`) ni se cambie la URL base de los recursos.
const SECURITY_HEADERS = [
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  // Vercel ya manda HSTS en sus dominios; explícito acá para que valga igual
  // en un dominio propio. Sin `preload`: eso es un compromiso difícil de revertir.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  webpack(config) {
    if (!process.env.VERCEL && process.env.NODE_ENV === 'development') {
      config.cache = { type: 'memory' };
    }
    return config;
  },
};

export default nextConfig;
