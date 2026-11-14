---
numero: 0038
titulo: Una compu en la que se entró con passkey puede quedar recordada 30 días, sin bloqueo
estado: Aceptada
fecha: 2026-11-14
codigo: lib/session.ts, lib/cookiesAuth.ts, middleware.ts, app/api/auth/passkey/acceso/route.ts, lib/passkeyCliente.ts, app/login/LoginCliente.tsx, components/FaceIdAjuste.tsx
---

# 0038 — Compu de confianza: 30 días sin bloqueo

Modifica a [0037](0037-ingreso-solo-con-passkey.md), que dejaba el bloqueo del
[0035](0035-bloqueo-con-passkey-en-cada-apertura.md) también en la compu.

## Contexto

Con el ingreso solo por passkey (0037), en la compu toda sesión venía con
bloqueo. Volver a la pestaña después de la tolerancia del
[0036](0036-bloquear-al-salir-con-una-marca-del-cliente.md) pedía la passkey
otra vez, y sin Windows Hello eso es escanear un QR con el celular cada vez.
El bloqueo está pensado para el teléfono, que se presta, se pierde y se mira
de reojo. En la compu, cambiar de pestaña es lo normal.

## Alternativas descartadas

- **Bloqueo más suave en la compu** (bloquear solo al reabrir el navegador o
  después de un rato sin uso) — sigue pidiendo la passkey seguido, y "un rato
  sin uso" el servidor no lo puede medir: lo tendría que reportar el cliente.
- **Solo registrar una passkey de Windows Hello** — cambia el QR por un PIN o
  la huella, pero el bloqueo sigue saltando en cada cambio de pestaña. Se
  puede hacer igual, es independiente de esto.
- **Detectar la compu en el servidor por el user agent, sin preguntar** — un
  iPad con Safari se presenta como Mac, y la decisión de recordar una compu
  ajena (la del trabajo, una prestada) tiene que ser del que entra.

## Decisión

**El login ofrece "Recordar esta compu por 30 días"**, marcado de entrada,
solo en una compu (`esCompu()`: puntero fino como entrada principal y no un
iPad). Entrar con passkey y la casilla marcada manda `recordar: true`, y
`/api/auth/passkey/acceso` abre una sesión con `confianza: true`:
**`SESSION_CONFIANZA_MAX_AGE` = 30 días** (arbitrario: un mes sin volver a
pedirla, sin que una compu olvidada quede abierta para siempre), sin bloqueo
ni desbloqueo.

- La marca va firmada en la sesión, como `bloqueo`, y se excluyen: si se piden
  las dos, gana el bloqueo.
- El middleware acepta en producción una sesión con `bloqueo` o con
  `confianza`. Las de contraseña no tienen ninguna de las dos y se siguen
  rechazando (0037): **la confianza solo se consigue con una passkey.**
- En el teléfono la casilla no aparece y nada cambia.
- El panel "Bloqueo con Face ID" dice que la compu está recordada. Activarlo
  ahí registra una passkey del dispositivo y pasa la sesión a bloqueo, como en
  el teléfono.

## Consecuencias y límites

- **Límite — quien use la compu desbloqueada ve la cartera** durante esos 30
  días. Es lo que se acepta a cambio de no pedir la passkey en cada pestaña.
  Para una compu ajena, desmarcar la casilla o cerrar sesión al terminar.
- **Límite — no se puede revocar una compu sola.** La sesión no se guarda en
  el servidor: si se pierde o roban la compu, la salida es rotar
  `SESSION_SECRET`, que cierra todas las sesiones.
- **Límite — `esCompu()` es una heurística.** Una notebook con pantalla táctil
  y un trackpad cuenta como compu, que es lo correcto. Una tablet con mouse
  podría contar también; la casilla está a la vista y se puede desmarcar.
- **Revisar si:** hace falta revocar dispositivos por separado (habría que
  guardar las sesiones en el servidor), o si 30 días resulta mucho o poco.
