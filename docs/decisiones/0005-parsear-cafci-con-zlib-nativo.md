---
numero: 0005
titulo: Parsear la planilla CAFCI con zlib nativo, sin librería de xlsx
estado: Aceptada
fecha: 2026-08-06
codigo: lib/fciCafci.ts
---

# 0005 — Parsear la planilla CAFCI con `zlib` nativo, sin librería de xlsx

## Contexto

Para mostrar VCP y rendimientos de los FCI en cartera hace falta una fuente de
datos de fondos comunes de inversión sin credenciales. CAFCI (Cámara Argentina de
Fondos Comunes de Inversión) publica sin auth un `.xlsx` con el universo completo
de FCI del país, actualizado a diario, en `https://api.pub.cafci.org.ar/pb_get`
(el botón "Descarga de la última planilla diaria" de cafci.org.ar). Un `.xlsx` es
un ZIP con XML adentro, así que consumirlo implica descomprimir y parsear.

## Alternativas descartadas

- **API del broker** — exige login de cliente; no hay endpoint público.
- **`api.cafci.org.ar`** (la API JSON de CAFCI) — devuelve 401 sin documentación de
  autenticación. La planilla pública es la única vía sin credenciales.
- **Paquete `xlsx` (SheetJS) de npm** — está clavado en 0.18.5 con dos CVEs de
  severidad alta sin parche publicado ahí (prototype pollution y ReDoS). Las
  versiones parcheadas se distribuyen solo desde el CDN propio de SheetJS, fuera
  de npm: instalarlas significa salirse del registry y del lockfile.
- **Otras librerías de xlsx** — resolverían el CVE, pero agregan una dependencia
  pesada para leer una sola planilla de formato estable.

## Decisión

Se parsea a mano con el `zlib` nativo de Node: se lee el *central directory* del
ZIP, se hace `inflateRawSync` de las entradas necesarias y se extraen las filas
del XML. El formato de fila/celda de esta planilla es estable y simple (celdas de
texto inline, sin `sharedStrings`), así que un parser mínimo alcanza y evita la
dependencia.

Las filas se filtran por Sociedad Gerente para quedarse solo con los fondos de la
administradora relevante, y se mapean los tickers de la cartera a los nombres
exactos de fondo+clase de la planilla.

El resultado se cachea 6 horas: la planilla se actualiza una vez por día hábil.

Consecuencia operativa: la ruta que consume esto necesita `runtime: 'nodejs'` (usa
`Buffer` y `zlib`), no puede correr en Edge.

## Consecuencias y límites

- **Límite — el parser es mínimo, no un lector de xlsx general.** Asume celdas de
  texto inline sin tabla de `sharedStrings`. Si CAFCI cambia cómo genera el
  archivo (por ejemplo, empieza a usar `sharedStrings` o compresión distinta de
  DEFLATE), rompe. El test cubre el formato actual.
- **Límite — el mapeo ticker → nombre de fondo es manual.** Si un fondo cambia de
  nombre o de clase en la planilla, esa fila deja de encontrarse en silencio.
- **Límite — los datos son de cierre del día hábil anterior**, no intradiarios.
- **Revisar si:** el parser empieza a fallar (probable cambio de formato en la
  planilla); SheetJS publica en npm una versión sin los CVEs; o aparece una API
  JSON pública de CAFCI o del broker.
