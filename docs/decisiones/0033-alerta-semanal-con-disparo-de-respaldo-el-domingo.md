---
numero: 0033
titulo: Disparar la alerta semanal dos veces el domingo y mandar un solo mail
estado: Aceptada
fecha: 2026-11-10
codigo: .github/workflows/alerta-semanal.yml, app/api/alertas/semanal/route.ts, lib/alertas.ts
---

# 0033 — Disparar la alerta semanal dos veces el domingo y mandar un solo mail

Reemplaza a [0015](0015-cron-semanal-en-github-actions.md). Se mantiene lo que
decidía: GitHub Actions como trigger (no Vercel Cron ni un servicio externo),
`CRON_SECRET` como autenticación y el job en rojo si la respuesta no es 200.
Cambia el horario y cómo se tolera la demora.

## Contexto

El mail es la agenda de la semana que arranca y tiene que llegar el domingo.
El 0015 lo programaba a las 00:00 UTC del lunes (domingo 21 hs ART) asumiendo
que la demora de GitHub era de minutos. No lo es: con ese horario las corridas
salieron entre 3 y 4 horas tarde, ya lunes en Argentina, y con el horario
anterior (lunes a la mañana) llegaron a salir 8 horas tarde. La hora en punto
es el pico de carga de los schedule de GitHub.

## Alternativas descartadas

- **Seguir con un solo disparo, más temprano** — reduce el riesgo pero no lo
  elimina: con una demora grande, el mail igual sale el lunes o no sale.
- **Varios disparos sin control** — llegaría un mail repetido por disparo.
- **Clave de idempotencia de Resend** — dura 24 horas y rechaza una segunda
  llamada con contenido distinto (los precios cambian entre disparos): habría
  que interpretar ese error como "ya enviado" sin poder probarlo sin mandar
  mails reales.
- **Guardar la fecha del último envío en el Sheet** — otra hoja y otra
  escritura para algo que el historial de Actions ya sabe.

## Decisión

Dos disparos el domingo, a minuto impar para esquivar el pico: 12:23 y 17:23
ART (`23 15 * * 0` y `23 20 * * 0`). El horario es arbitrario: lo bastante
temprano como para que una demora de varias horas siga cayendo en domingo.

Antes de llamar al endpoint, el workflow decide:

- si ya hay una corrida programada exitosa desde las 00:00 ART de ese día, no
  hace nada (es el respaldo y el mail ya salió);
- si el disparo llegó cuando en Argentina ya no es domingo, llama con
  `?mail=0`: no manda el mail, pero registra los pagos de bonos de la semana
  (ADR 0031), que no pueden esperar al domingo siguiente;
- si no, llama normal.

Un disparo manual (`workflow_dispatch`) siempre manda el mail.

La ventana del mail arranca el lunes cuando el job corre un domingo
(`inicioVentana` en `lib/alertas.ts`), así que sigue siendo lunes→domingo de
la semana que empieza, aunque el disparo sea a la tarde y no a medianoche.

## Consecuencias y límites

- **Límite:** el mail llega el domingo al mediodía, no a la noche.
- **Límite:** si los dos disparos se demoran hasta el lunes, esa semana no hay
  mail (solo el registro de pagos). Se eligió eso a mandar uno el lunes.
- **Límite:** si la primera corrida manda el mail pero falla después (por
  ejemplo, el registro de pagos), queda en rojo y el respaldo manda el mail de
  nuevo.
- **Límite:** sigue vigente lo del 0015: GitHub suspende los schedule de un
  repo sin actividad por ~60 días, y el secreto vive en GitHub y en Vercel.
- **Revisar si:** las demoras de GitHub superan las ~5 horas de forma habitual
  (ahí conviene un scheduler con horario garantizado).
