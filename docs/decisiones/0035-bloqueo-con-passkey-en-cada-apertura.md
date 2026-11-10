---
numero: 0035
titulo: Bloquear la app con una passkey en cada apertura, con un desbloqueo corto que renueva un latido
estado: Aceptada
fecha: 2026-11-10
codigo: lib/webauthn.ts, lib/session.ts, lib/cookiesAuth.ts, lib/passkeys.ts, lib/passkeyCliente.ts, middleware.ts, app/api/auth/passkey/acceso/route.ts, app/api/auth/passkey/registro/route.ts, app/api/auth/sesion/route.ts, app/api/auth/login/route.ts, components/BloqueoFaceId.tsx, components/FaceIdAjuste.tsx, app/login/page.tsx
---

# 0035 — Bloquear la app con una passkey en cada apertura

## Contexto

La app se usa desde el celular, agregada a la pantalla de inicio. La sesión
dura 7 días (ADR 0014): quien tenga el teléfono desbloqueado en la mano ve la
cartera entera. Se quería que la app pida Face ID cada vez que se abre, como
una app de banco, y no solo al iniciar sesión.

Restricciones reales: una web app no tiene acceso a Face ID salvo por WebAuthn
(passkeys); el chequeo de acceso vive en el middleware, en Edge runtime, sin
`node:crypto`; y el servidor no se entera de cuándo la app pasa al fondo, solo
de los pedidos que le llegan.

## Alternativas descartadas

- **Face ID solo al iniciar sesión** — más simple, pero con la sesión de 7 días
  casi nunca se vería, y no protege el teléfono desbloqueado en otras manos.
- **Bloqueo solo en el cliente** (un overlay que pide Face ID al volver) — es
  decorativo: los datos ya están en la página y las APIs siguen respondiendo a
  la cookie de sesión. El bloqueo tiene que estar en el middleware.
- **Acortar la sesión a minutos** — obliga a reingresar también en la compu,
  donde no hay Face ID, y mezcla dos cosas: estar autenticado y haber
  desbloqueado este dispositivo hace un rato.
- **Llevar la cuenta del tiempo en segundo plano en el cliente** — el servidor
  no lo puede verificar y iOS suspende la página en el fondo; el vencimiento
  tiene que ser una cookie firmada que vence sola.
- **`@simplewebauthn/server` u otra librería** — resuelve todo WebAuthn, pero
  con un solo usuario y un solo algoritmo lo necesario son dos verificaciones
  de firma con WebCrypto, el mismo criterio que la sesión sin librería de JWT
  (ADR 0014).
- **Passkeys en una variable de entorno** — sin camino de escritura, pero cada
  alta o baja cuesta un redeploy. Van a la hoja `Passkeys` del Sheet.

## Decisión

**Passkeys verificadas con WebCrypto** (`lib/webauthn.ts`): solo ES256,
`attestation: 'none'`, credenciales descubribles, y se exigen los flags UP y UV
(UV es lo que garantiza Face ID y no solo un toque). El alta pide sesión y
acepta la clave pública de `getPublicKey()` sin attestation, porque quien la
manda ya está autenticado. Se guardan id y clave pública en la hoja `Passkeys`;
la baja es borrar la fila. El desafío va firmado en una cookie de 2 minutos: el
servidor no guarda estado.

**Dos cookies, no una.** `session` (7 días) lleva una marca `bloqueo` firmada;
la pone entrar con passkey o registrar una. `desbloqueo` dura
**`DESBLOQUEO_MAX_AGE = 120` s** (arbitrario: el margen para volver a la app
sin pasar de nuevo por Face ID). Una sesión con bloqueo sin desbloqueo vigente
no pasa el middleware: las páginas redirigen a `/login?bloqueado=1`, que abre
Face ID, y las APIs devuelven 401 (una redirección le llegaría al `fetch` como
un 200 con HTML).

**El latido renueva el desbloqueo** (`/api/auth/sesion`, cada 30 s mientras la
app está a la vista). Al ir al fondo el latido se corta y el desbloqueo vence
entre 90 y 120 s después; al volver, el primer latido recibe 401. Mientras la
app está oculta una tapa cubre el contenido, para la captura del selector de
apps de iOS.

**Los tres tokens llevan `tipo` firmado** (`sesion`, `desbloqueo`, `reto`). Es
obligatorio: el endpoint público de passkey firma un reto para cualquiera, y
sin el tipo ese token valdría como sesión. Los tokens viejos sin `tipo` se leen
como sesión sin bloqueo, para no cerrar las sesiones abiertas.

**La contraseña sigue sirviendo** en la pantalla de bloqueo, y no apaga el
bloqueo: el login con contraseña lee la sesión anterior (aunque haya vencido,
con firma válida) y conserva la marca.

## Consecuencias y límites

- **Límite — el margen es de hasta 2 minutos.** Volver a la app antes no pide
  Face ID. Bajar `DESBLOQUEO_MAX_AGE` lo achica, pero el latido tiene que
  seguir siendo bastante más corto que el desbloqueo.
- **Límite — cerrar sesión apaga el bloqueo del dispositivo** hasta el próximo
  ingreso con Face ID: la marca vive en la cookie de sesión.
- **Límite — Safari puede no abrir Face ID sin un toque** al cargar la
  pantalla de bloqueo. Queda el botón.
- **Límite — sin contador de firmas ni attestation.** Las passkeys de iCloud
  mandan contador 0, y no se verifica qué autenticador creó la clave.
- **Límite — atado al dominio.** El rpId es el hostname del pedido: una passkey
  registrada en producción no sirve en un preview ni en localhost.
- **Revisar si:** hay más de un usuario (el `user.id` es fijo y la hoja no
  distingue dueños), o si se necesita revocar el desbloqueo de un dispositivo
  desde otro.
