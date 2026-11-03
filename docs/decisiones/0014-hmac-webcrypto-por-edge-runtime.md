---
numero: 0014
titulo: Firmar la sesión con HMAC y WebCrypto, no guardar el secreto en la cookie
estado: Aceptada
fecha: 2026-08-06
codigo: lib/session.ts, middleware.ts, lib/timingSafe.ts
---

# 0014 — Firmar la sesión con HMAC y WebCrypto, no guardar el secreto en la cookie

## Contexto

El dashboard es de un solo usuario y está detrás de un login simple. La primera
versión usaba como cookie de sesión el valor de `SESSION_SECRET` en texto plano: si
la cookie coincidía con el secreto, la sesión era válida.

Eso tiene dos problemas. Primero, cualquier filtración de la cookie (un log, una
extensión del browser, un backup, un screenshot de devtools) filtra el secreto del
servidor entero. Segundo, no hay forma de invalidar una sesión sin rotar el secreto y
tirar abajo todas las demás.

Restricción técnica: el chequeo de sesión vive en `middleware.ts`, que en Next.js
corre en el **Edge runtime**. Ahí no está disponible `node:crypto`.

## Alternativas descartadas

- **La cookie es el secreto** (lo que había) — filtrar la cookie filtra el secreto
  del servidor y no se puede invalidar una sesión sola.
- **Sesiones con estado en servidor** (store de sesiones) — para un usuario único
  agrega una dependencia de almacenamiento y un punto de falla, sin beneficio real.
- **Una librería de JWT** — resuelve el problema, pero trae dependencia y superficie
  de configuración (algoritmos, `alg: none`, claims) para lo que acá son 40 líneas.
- **`node:crypto` para el HMAC** — no está disponible en el Edge runtime donde corre
  el middleware. Obligaría a mover el chequeo de sesión a cada route handler, o a
  forzar el middleware a runtime Node.

## Decisión

La cookie es `<payload_base64url>.<firma>`, con HMAC-SHA256 sobre el payload y la
expiración **adentro** del payload (`{ sub, exp }`, 7 días). El secreto nunca viaja
al cliente: filtrar la cookie compromete solo esa sesión, y solo hasta que expire.

El HMAC se hace con **WebCrypto** (`crypto.subtle`), que existe tanto en Edge como en
Node, así que el mismo módulo lo pueden importar el middleware y los route handlers.

Un token malformado (base64 inválido, JSON roto, firma que no verifica, expirado) da
el mismo resultado que uno inválido: `null`. No se distinguen los motivos hacia
afuera.

La comparación de secretos que no pasan por HMAC —el `CRON_SECRET` de la alerta
semanal— usa `lib/timingSafe.ts`, para no filtrar información por tiempo de
respuesta.

## Consecuencias y límites

- **Límite — no hay revocación anticipada.** Un token firmado es válido hasta su
  `exp`; no hay lista de revocación. Para invalidar todo antes de tiempo hay que
  rotar `SESSION_SECRET`, que cierra todas las sesiones.
- **Límite — el payload es legible** (base64, no cifrado). Está firmado, no
  encriptado: cualquiera puede leer `sub` y `exp` de su propia cookie. No se debe
  poner nada sensible ahí.
- **Límite — todo depende de `SESSION_SECRET`.** Si es débil o se filtra, se pueden
  forjar tokens.
- **Límite — atado a WebCrypto.** Si alguna vez se usa este módulo en un entorno sin
  `crypto.subtle`, hay que reimplementarlo.
- **Revisar si:** el dashboard pasa a tener más de un usuario (ahí conviene revisar
  revocación y roles); o si hace falta invalidar sesiones individuales.
