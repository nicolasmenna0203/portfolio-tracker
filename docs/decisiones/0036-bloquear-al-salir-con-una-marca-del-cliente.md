---
numero: 0036
titulo: Bloquear al salir de la app con una marca que pone el cliente, sobre el vencimiento del servidor
estado: Aceptada
fecha: 2026-11-10
codigo: components/BloqueoFaceId.tsx, middleware.ts, lib/cookiesAuth.ts
---

# 0036 — Bloquear al salir de la app con una marca que pone el cliente

## Contexto

Con el ADR 0035, salir de la app no la bloqueaba de inmediato: el desbloqueo
vencía entre 90 y 120 s después del último latido. En el uso real eso se
leyó como que el bloqueo no funcionaba: se cierra la app, se la vuelve a abrir
enseguida y entra sin Face ID. Una app de banco bloquea al salir.

El servidor no se entera de cuándo la app pasa al fondo, y en ese momento iOS
suspende la página casi enseguida: un pedido de red al irse (`sendBeacon`,
`fetch` con `keepalive`) puede no llegar, y no está garantizado que el
navegador aplique la cookie que devuelva.

## Alternativas descartadas

- **Bajar `DESBLOQUEO_MAX_AGE` a pocos segundos** — el latido tendría que ser
  todavía más frecuente, y una red lenta bloquearía la app con la pantalla
  encendida.
- **Avisarle al servidor al salir** (`sendBeacon` a un endpoint que borre el
  desbloqueo) — depende de que el pedido salga y de que su respuesta se aplique
  con la página ya suspendida; en iOS no es confiable.
- **Bloquear solo en el cliente al volver** — es lo que descartó el 0035: el
  bloqueo tiene que estar en el middleware.

## Decisión

Al irse la app al fondo (`visibilitychange` → `hidden`), `BloqueoFaceId` pone la
cookie **`app_oculta`** con `document.cookie`: es sincrónico y no necesita red.
El middleware trata una sesión con bloqueo que tenga esa cookie igual que una
sin desbloqueo: redirige a Face ID, o 401 en las APIs. Solo un ingreso válido
(passkey o contraseña) la borra del lado del servidor.

Si la página vuelve a la vista antes de **`TOLERANCIA_MS = 10 s`** (arbitrario:
el tiempo de mirar otra app y volver), ella misma saca la marca. Si la app se
cerró del todo, no hay página que la saque y el primer pedido al abrirla ya
viene marcado.

La marca **solo puede endurecer**: no es httpOnly, así que quien tenga acceso a
las cookies del navegador la puede borrar, pero sin ella vuelve a regir el
vencimiento de 2 minutos del 0035, que sigue firmado por el servidor.

## Consecuencias y límites

- **Límite — la marca la pone el cliente.** Si el evento no llega a correr
  (la página se mata sin pasar por `hidden`), queda solo el vencimiento del
  0035.
- **Límite — en desktop, cambiar de pestaña cuenta como salir.** Dos pestañas
  del dashboard con bloqueo se pueden bloquear una a la otra.
- **Límite — si algo del sistema oculta la página más de 10 s** en medio de un
  uso normal (por ejemplo, si un selector de archivos la pusiera en `hidden`),
  al volver se bloquea y se pierde lo que estaba a medio cargar.
- **Revisar si:** iOS ofrece una señal confiable de cierre que llegue al
  servidor, o si la tolerancia resulta corta o larga en el uso.
