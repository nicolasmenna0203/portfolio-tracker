---
numero: 0041
titulo: El historial de briefs se guarda en el Sheet desde el job del domingo
estado: Aceptada
fecha: 2026-11-22
codigo: lib/briefsGuardados.ts, app/api/alertas/semanal/route.ts, app/api/briefs/route.ts, components/BriefTab.tsx
---

# 0041 — El historial de briefs se guarda en el Sheet desde el job del domingo

## Contexto

El brief de noticias y fundamentales (ADR 0040) solo existía en el mail del
domingo y en un `brief.json` que la sesión del sábado pisa cada semana. Hacía
falta verlo en el dashboard, con las semanas anteriores. El dashboard corre en
Vercel y lee el Sheet con la service account; no tiene credenciales de GitHub,
y el repo donde vive el brief es privado. El job del domingo ya recibe el brief
en el cuerpo del POST y ya escribe en el Sheet (PagosBonos).

## Alternativas descartadas

- **Leer `brief.json` de la rama `datos-semanales` desde Vercel** — necesita un
  token de GitHub nuevo en Vercel, que hay que crear y renovar a mano; además
  esa rama solo tiene la última semana.
- **Que la sesión del sábado guarde un archivo por semana en la rama** — da el
  historial, pero el dashboard sigue sin poder leerlo sin ese token.
- **Que la sesión del sábado escriba en el Sheet** — no tiene las credenciales
  de la service account; dárselas es compartir un secreto con algo que corre
  fuera del repo (ya descartado en ADR 0040).
- **Guardarlo en el navegador** — solo existiría en el dispositivo que abrió el
  dashboard ese día, y el servidor MCP no lo vería.

## Decisión

- El job del domingo, además de mandar el mail, guarda el brief en la hoja
  `Briefs` (la crea si falta): una fila por semana con FECHA, BRIEF (el JSON en
  la forma que escribe la sesión) y GUARDADO.
- Guardar reemplaza la fila de la misma fecha: el job corre dos veces el
  domingo (ADR 0033) y, si la sesión del sábado no corrió, vuelve a recibir el
  brief anterior.
- Se guarda aunque el mail no salga (`?mail=0`). Si guardar falla, la respuesta
  lo informa pero sigue siendo 200: un 500 haría que la corrida de respaldo
  reenvíe el mail.
- Una celda admite 50.000 caracteres y un brief al máximo de sus topes puede
  pasarlos. Por encima de 49.000 (margen arbitrario) se sacan primero las
  fuentes y después los últimos activos, que la sesión ordena de mayor a menor
  importancia.
- La pestaña Brief lee la hoja con `/api/briefs`, que vuelve a validar cada
  fila con `parsearBrief`: una celda editada a mano o rota se descarta.

## Consecuencias y límites

- **Límite:** un domingo en que guardar falla, esa semana falta en la pestaña
  aunque el mail haya salido; solo queda en el log de GitHub Actions. Se puede
  completar a mano copiando el JSON de la rama en una fila nueva.
- **Límite:** las semanas anteriores a esta decisión no están, salvo que se
  carguen a mano.
- **Límite:** el brief sigue siendo texto de un modelo: el código valida la
  forma, no que las noticias sean ciertas.
- **Revisar si:** el dashboard pasa a tener acceso de lectura al repo privado,
  o la hoja se acerca a las 600 filas que se leen (más de diez años).
