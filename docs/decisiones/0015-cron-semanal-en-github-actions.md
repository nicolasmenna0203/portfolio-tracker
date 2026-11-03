---
numero: 0015
titulo: Disparar la alerta semanal desde GitHub Actions, no desde Vercel Cron
estado: Aceptada
fecha: 2026-08-06
codigo: .github/workflows/alerta-semanal.yml, app/api/alertas/semanal/route.ts
---

# 0015 — Disparar la alerta semanal desde GitHub Actions, no desde Vercel Cron

## Contexto

La alerta semanal de cobros (`GET /api/alertas/semanal`) resume los cobros esperados
de los próximos 7 días y los manda por mail. Tiene que dispararse a un **horario
exacto**: el contenido es la agenda de la semana que arranca, así que llegar tarde o
en un horario variable le resta utilidad.

El dashboard está deployado en Vercel, así que Vercel Cron era la opción por defecto.
Pero en el plan Hobby los cron jobs corren **como máximo una vez por día y sin
garantía de horario preciso**: no se puede pedir un horario fijo exacto.

## Alternativas descartadas

- **Vercel Cron en plan Hobby, diario** — habría que ejecutar todos los días y
  chequear el día de la semana dentro del handler, descartando 6 de 7 ejecuciones. Y
  aun así el horario del envío queda a criterio de la plataforma.
- **Upgrade al plan Pro de Vercel** — resuelve el cron, pero es un costo mensual para
  un solo job semanal.
- **Servicio externo de cron** (cron-job.org y similares) — funciona y permite el
  horario exacto, pero agrega una cuenta más de terceros con un secreto configurado
  afuera del repo.

## Decisión

El trigger es un workflow de **GitHub Actions** (`.github/workflows/alerta-semanal.yml`)
con `schedule: '0 0 * * 1'` — domingo 21:00 ART = lunes 00:00 UTC (Argentina no tiene
horario de verano, así que el offset es fijo y no hace falta corregirlo dos veces por
año). El rango de cobros que calcula `calcularAlertaSemanal` (lunes→domingo) usa ese
mismo instante como ancla de "hoy", así que el horario del cron y el rango mostrado en
el mail están acoplados: si se cambia uno, hay que revisar el otro.

El workflow hace `curl` al endpoint y **falla el job si la respuesta no es 200**, de
modo que un envío roto aparece como un check rojo en GitHub en vez de pasar
desapercibido.

Autenticación: el endpoint no usa la cookie de sesión (no hay browser) sino un secreto
propio, `CRON_SECRET`, pasado como `Authorization: Bearer <secret>` y comparado con
`lib/timingSafe.ts`. En GitHub va como *secret* del repo; la URL del dashboard como
*variable*. El endpoint está excluido del middleware de auth por eso.

Incluye `workflow_dispatch` para poder dispararlo a mano desde la pestaña Actions.

## Consecuencias y límites

- **Límite — el `schedule` de GitHub Actions no es puntual.** GitHub encola los jobs y
  puede demorarlos varios minutos (más en horarios de alta demanda). Para una alerta
  semanal es irrelevante, pero no sirve para algo que necesite precisión al minuto.
- **Límite — GitHub deshabilita los cron de repos inactivos.** En repos públicos sin
  actividad por ~60 días, el schedule se suspende hasta que alguien haga un commit o
  lo reactive. Si las alertas dejan de llegar sin error visible, ese es el primer lugar
  donde mirar.
- **Límite — el secreto vive en dos lugares** (GitHub y Vercel) y hay que rotarlo en
  los dos.
- **Límite — el endpoint queda fuera del middleware de auth.** Su única protección es
  `CRON_SECRET`; si se filtra, cualquiera puede disparar el envío.
- **Revisar si:** hace falta más de un job programado o precisión horaria real (ahí
  conviene reevaluar el plan Pro de Vercel o un scheduler dedicado); o si las alertas
  se cortan sin error, por la suspensión de cron por inactividad.
