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
const nextConfig: NextConfig = {
  webpack(config) {
    if (!process.env.VERCEL && process.env.NODE_ENV === 'development') {
      config.cache = { type: 'memory' };
    }
    return config;
  },
};

export default nextConfig;
