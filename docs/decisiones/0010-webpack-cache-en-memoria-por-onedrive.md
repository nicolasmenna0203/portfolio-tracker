---
numero: 0010
titulo: Cache de webpack en memoria en desarrollo, porque el repo vive en OneDrive
estado: Aceptada
fecha: 2026-08-06
codigo: next.config.ts
---

# 0010 — Cache de webpack en memoria en desarrollo, porque el repo vive en OneDrive

## Contexto

El proyecto está dentro de una carpeta sincronizada por OneDrive. OneDrive bloquea y
renombra archivos por detrás mientras los sincroniza, y `.next/` se escribe
constantemente durante `next dev`. El resultado son builds corruptos con errores que
no tienen relación con el código: `ENOENT` al renombrar manifests y `.pack.gz`, o
`Cannot find module './NNN.js'`.

Es un problema del entorno, no del proyecto, pero se manifiesta como si el código
estuviera roto — y la reacción natural (borrar `.next/` y reintentar) lo esconde por
un rato y lo trae de vuelta después.

## Alternativas descartadas

- **`distDir` con ruta absoluta** (por ejemplo `os.tmpdir()`) — Next la concatena a la
  raíz del proyecto y genera una ruta inválida tipo
  `C:\...\PROYECTO\C:\Users\...\Temp\...` → `ENOENT` al arrancar.
- **`distDir` con ruta relativa fuera del proyecto** (`'../../../...'`) — el build
  queda fuera del árbol de `node_modules` y falla con
  `Cannot find module 'react/jsx-runtime'`.
- **Mover el repo fuera de OneDrive** — es la solución de fondo, pero implica perder
  la sincronización del proyecto entre máquinas.
- **Pausar la sincronización de OneDrive** mientras se desarrolla — funciona, pero
  depende de acordarse cada vez.

## Decisión

Se deja `distDir` en su valor por defecto (`.next`) y se pasa el cache de webpack a
**memoria**, solo en desarrollo y solo fuera de Vercel:

```ts
webpack(config) {
  if (!process.env.VERCEL && process.env.NODE_ENV === 'development') {
    config.cache = { type: 'memory' };
  }
  return config;
}
```

Los `.pack.gz` del filesystem cache son precisamente los archivos que OneDrive
renombra por detrás. Sin cache en disco, desaparece la fuente del `ENOENT`.

## Consecuencias y límites

- **Límite — las recompilaciones son algo más lentas** y el cache se pierde al
  reiniciar el dev server. Es el costo aceptado a cambio de estabilidad.
- **Límite — no aplica en Vercel** (el guard de `process.env.VERCEL` lo evita), así
  que el build de producción conserva su cache normal.
- **Límite — es una mitigación, no una cura.** Si el `ENOENT` reaparece por otros
  archivos de `.next/`, las salidas son pausar la sincronización de OneDrive o mover
  el repo afuera.
- **Esto no es un bug para "arreglar".** Sacar el override devuelve los errores de
  build fantasma.
- **Revisar si:** el repo se muda fuera de OneDrive (ahí el override sobra); o si Next
  cambia cómo resuelve `distDir` y una ruta absoluta pasa a funcionar.
