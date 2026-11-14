---
numero: 0037
titulo: En producción se entra solo con passkey; la contraseña queda como recuperación que se prende a mano
estado: Aceptada
fecha: 2026-11-14
codigo: lib/session.ts, middleware.ts, app/api/auth/login/route.ts, app/login/page.tsx, app/login/LoginCliente.tsx, app/api/auth/passkey/registro/route.ts, app/api/auth/passkey/acceso/route.ts, lib/webauthn.ts, lib/avisoSeguridad.ts, next.config.ts, app/layout.tsx
---

# 0037 — En producción se entra solo con passkey

Modifica a [0035](0035-bloqueo-con-passkey-en-cada-apertura.md): ahí la
contraseña seguía sirviendo en la pantalla de bloqueo. Lo demás del 0035 (dos
cookies, latido, desbloqueo corto) y del 0036 (marca al salir) sigue igual.

## Contexto

Una auditoría del ingreso encontró que la contraseña era la llave maestra.
Abría una sesión sin bloqueo, así que se salteaba Face ID, y con esa sesión se
podía registrar una passkey. Esa passkey nueva era un acceso que sobrevivía a
cambiar la contraseña y a rotar `SESSION_SECRET`, porque vive en la hoja
`Passkeys`, y nada avisaba que se había creado. Con la contraseña filtrada (o
una cookie de sesión robada, que dura 7 días) alcanzaba para quedarse adentro
para siempre.

El objetivo es que no pueda entrar nadie más que el dueño, sin depender de lo
fuerte que sea una contraseña.

## Alternativas descartadas

- **Contraseña + segundo factor TOTP** — cierra la contraseña filtrada, pero
  agrega un secreto más que guardar y fricción en cada ingreso, y sigue siendo
  phisheable: un sitio falso puede pedir el código y usarlo al momento. Una
  passkey no firma para otro dominio.
- **Dejar la contraseña, con avisos y límite de intentos** — el firewall de
  Vercel ya limita los intentos por IP. Avisar sirve para enterarse, no
  impide nada: el atacante entra igual, y lo que se puede hacer después
  depende de leer el mail a tiempo.
- **Exigir la contraseña al registrar una passkey** — sin contraseña en
  producción no hay qué pedir. Con la contraseña apagada, registrar ya exige
  un desbloqueo con passkey vigente (middleware), y cada alta manda un aviso.
- **Apagar la contraseña también fuera de producción** — las passkeys están
  atadas al dominio: una de producción no sirve en localhost, y en dev no
  habría forma de entrar.
- **`robots.txt` con `Disallow: /`** para que no aparezca en buscadores — un
  buscador que no puede rastrear una página no ve su `noindex`, y si encuentra
  el link en otro lado igual puede listar la URL sin contenido. Sin bloquear
  el rastreo, lo único que alcanza es el login, que dice `noindex`.

## Decisión

**La contraseña no abre sesión en producción** salvo que
`PERMITIR_CONTRASENA=true` esté en las variables de Vercel
(`contrasenaHabilitada()` en `lib/session.ts`, que leen el middleware, la ruta
de login y la página de login). Apagada:

- `/api/auth/login` responde 403 sin comparar credenciales: no sirve ni para
  probar contraseñas.
- La página de login no muestra el formulario. Donde no hay Face ID (una compu
  sin Windows Hello) el botón abre el diálogo del sistema, que ofrece el QR
  para usar la passkey del celular. Por eso el ingreso no pone
  `allowCredentials` ni restringe el tipo de autenticador.
- **El middleware rechaza toda sesión sin bloqueo.** Con la contraseña apagada,
  toda sesión válida viene de una passkey (con bloqueo, o de una compu de
  confianza según el [0038](0038-compu-de-confianza.md)); una sin ninguna de las dos marcas es de antes del
  cambio o de cuando la contraseña estuvo prendida, y deja de valer apenas se
  apaga la variable.

`PERMITIR_CONTRASENA` es **la vía de recuperación** si se pierden todos los
dispositivos con passkey: prenderla exige entrar a Vercel y redeployar, que es
una barrera mucho más alta que saber una contraseña. Se apaga apenas se
registra una passkey nueva.

**Avisos por mail** (`lib/avisoSeguridad.ts`, por Resend a `ALERTA_EMAIL`): al
registrar una passkey y al entrar con contraseña. Se mandan con `after()`,
después de responder, y un mail caído no frena el ingreso. No se avisa cada
ingreso con passkey: pasa en cada apertura de la app.

**Ajustes de la misma auditoría:**

- El endpoint público de passkey chequea todo lo que no necesita la clave
  pública (desafío, origen, rpId, flags, forma de la firma) antes de leer la
  hoja `Passkeys`. Cualquiera puede pedir un reto, y cada lectura gasta cuota
  de Google Sheets, la misma que usa el dashboard.
- Un token sin `tipo` ya no vale como sesión. Era la compatibilidad con los
  tokens anteriores al 0035, ya vencidos.
- Las rutas públicas del middleware se comparan por ruta exacta o por lo que
  cuelga de ella (`/demo/...`), no por prefijo de texto: `/demo` ya no abre
  una futura `/demografia`.
- `X-Robots-Tag: noindex, ...` en todas las respuestas (`next.config.ts`) y
  `robots` en el `metadata` del layout.

## Consecuencias y límites

- **Límite — perder todos los dispositivos con passkey** deja afuera hasta
  prender `PERMITIR_CONTRASENA` en Vercel. Las passkeys de iCloud se
  sincronizan entre los dispositivos Apple, así que perder uno no alcanza.
- **Límite — en la compu también rige el bloqueo.** Entrar con passkey abre
  una sesión con bloqueo: al volver a la pestaña después de la tolerancia
  del 0036 se pide la passkey de nuevo (Windows Hello o el QR). *Modificado
  por el [0038](0038-compu-de-confianza.md): una compu puede quedar recordada
  30 días sin bloqueo, siempre entrando con passkey.*
- **Límite — los avisos dependen de Resend.** Con el remitente sandbox solo
  llegan al mail de la cuenta de Resend. Si `RESEND_API_KEY` o
  `ALERTA_EMAIL` faltan, el ingreso funciona igual y el aviso queda en el log.
- **Límite — `noindex` no esconde el sitio.** Los buscadores serios lo
  respetan, pero la URL puede aparecer en otros lados (registros públicos de
  certificados, por ejemplo). La protección real es que no se entra sin
  passkey.
- **Cerrar sesión ya no apaga el bloqueo** en producción, a diferencia de lo que
  dice el 0035: el próximo ingreso es con passkey sí o sí.
- **Revisar si:** hace falta entrar desde un dispositivo sin passkey ni celular
  a mano, o si hay más de un usuario.
