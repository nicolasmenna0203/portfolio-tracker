---
numero: 0040
titulo: El brief de noticias y fundamentales lo escribe una sesión programada en una rama privada y el workflow lo manda al job
estado: Aceptada
fecha: 2026-11-18
codigo: lib/briefSemanal.ts, lib/alertas.ts, lib/revisionTecnica.ts, app/api/alertas/semanal/route.ts, .github/workflows/alerta-semanal.yml, vercel.json
---

# 0040 — El brief de noticias y fundamentales lo escribe una sesión programada en una rama privada y el workflow lo manda al job

## Contexto

El mail del domingo tenía datos (cobros, variación, niveles técnicos) pero no
explicaba qué pasó con cada activo ni qué significa para el plan. Eso requiere
leer noticias y resultados y redactar: no es un cálculo. Las condiciones: sin
clave de API de modelos en el dashboard (la redacción sale de una sesión de
Claude del plan del usuario, que corre aparte) y sin pasos manuales de setup.
La sesión programada no tiene credenciales del Sheet; sí puede commitear al
repo privado. El workflow del domingo ya corre en ese repo y tiene su token.

## Alternativas descartadas

- **Llamar a la API de Anthropic desde el job** — agrega una clave y un costo
  por uso que el usuario no quiere.
- **Dejar el brief en una carpeta de Drive y leerlo con la service account** —
  exige habilitar la API de Drive en el proyecto de Google Cloud y compartir la
  carpeta a mano; además el conector de Drive de la sesión crea archivos pero
  no reemplaza su contenido, así que habría que buscar el más reciente.
- **Que la sesión escriba en el Sheet** — no tiene credenciales de la service
  account; dárselas es compartir un secreto con algo que corre fuera del repo.
- **Un endpoint que reciba el brief desde la sesión** — necesita un secreto en
  el prompt de la tarea programada y una variable nueva en Vercel.
- **Commitear el brief en `main`** — `main` se publica en el espejo (ADR 0030)
  y el brief nombra los activos de la cartera; además deployaría cada sábado.
- **Que la sesión programada mande su propio mail** — dos mails separados para
  información que se lee junta.

## Decisión

- La sesión programada del sábado investiga en la web, redacta y commitea
  `brief.json` en la rama huérfana `datos-semanales` del repo privado. La misma
  rama guarda `niveles.json` (los niveles del ADR 0039), que se editan ahí
  cuando cambia el plan.
- Esa rama no se publica (el espejo exporta solo `main`), no corre CI (el CI
  escucha `main` y PRs) y no se deploya (`vercel.json` en `main` y en la propia
  rama apagan los deploys).
- El workflow del domingo lee los dos archivos con `GITHUB_TOKEN` (permiso
  `contents: read` del propio repo) y llama al job con POST y cuerpo
  `{ brief, niveles }`, autenticado con el `CRON_SECRET` de siempre. GET sigue
  andando igual, sin esos bloques.
- El brief entra solo si su `fecha` es de hace 4 días o menos (arbitrario:
  cubre un sábado que corre tarde y deja afuera el de la semana anterior). Es
  texto de un modelo: se valida la forma, se recortan los largos (resumen 900,
  campos 500, hasta 25 activos y 3 fuentes cada uno), los links solo pasan si
  son http(s) y todo se escapa al renderizar.
- Los niveles del POST tienen prioridad; si no vienen, se leen de la hoja
  `NivelesTecnicos` si existe.
- Cualquier archivo faltante o inválido no corta el mail: sale sin ese bloque.

## Consecuencias y límites

- **Límite:** la calidad del brief depende de la sesión del sábado; el código
  no puede verificar que las noticias sean ciertas, solo que tengan forma.
- **Límite:** si la sesión no corre ese sábado, el domingo no hay bloque de
  noticias; no se reusa el de la semana anterior.
- **Límite:** un disparo manual del workflow también manda los datos de la
  rama, pero llamar al endpoint a mano con GET no incluye ni brief ni niveles
  de la rama.
- **Revisar si:** el repo deja de ser privado, o el espejo pasa a exportar
  ramas además de `main`.
