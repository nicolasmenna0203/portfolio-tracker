---
numero: 0016
titulo: Dar memoria al asesor con un archivo de perfil local, con escritura acotada
estado: Aceptada
fecha: 2026-08-08
codigo: lib/perfilInversor.ts, lib/agentTools.ts
---

# 0016 — Dar memoria al asesor con un archivo de perfil local, con escritura acotada

## Contexto

El servidor MCP da los datos de la cartera, pero no el marco para interpretarlos.
Sin objetivo, horizonte ni criterios de venta, toda lectura interpretativa —si
conviene rebalancear, si hay demasiada concentración— sale genérica o, peor,
contradice criterios que el usuario ya tenía definidos.

Las conversaciones no acumulan contexto entre sí: cada chat de un Proyecto de
Claude Desktop arranca leyendo lo mismo. Explicar el perfil en una conversación no
sirve para la siguiente.

Restricción de privacidad: el repositorio es público, y el perfil (objetivo,
tolerancia al riesgo, decisiones concretas) es personal por definición.

## Alternativas descartadas

- **Pegar el perfil en las instrucciones del Proyecto** — funciona para leer, pero
  hay que repegar el texto entero cada vez que cambia, y no da forma de que el
  perfil se actualice desde la conversación.
- **Solo lectura, sin tool de escritura** — evita de raíz el riesgo de ruido, pero
  deja toda la carga de actualización en el usuario. Se descartó porque el pedido
  explícito era que la memoria se preserve sin trabajo manual.
- **Escritura libre sobre todo el archivo** — permitiría al modelo reescribir
  criterios y reorganizar secciones. Descartado: un modelo con permiso de
  sobrescritura sobre el documento que define cómo se lo evalúa puede degradarlo
  sin que nadie lo note, y no hay control de versiones (el archivo está fuera del
  repo).
- **Guardar el perfil en el Google Sheet** — quedaría junto al resto de los datos y
  versionado por Google, pero mezcla prosa de criterios con datos tabulares y
  agrega latencia de API a algo que es un archivo de texto.
- **Versionar el perfil en el repo** — imposible: el repo es público.

## Decisión

Un archivo `PERFIL-INVERSOR.md` en la raíz del proyecto, **fuera del repositorio**
(en `.gitignore`, igual que `PROYECTO-CLAUDE.md`), con dos tools nuevas en el MCP:

- **`perfil_inversor`** — lee el archivo completo. Sin cache: el usuario lo puede
  editar a mano en cualquier momento, y responder con una versión vieja sería peor
  que no tener perfil. Que el archivo no exista **no es un error**: devuelve
  `existe: false` con una explicación, y el modelo sigue pudiendo responder
  avisando que el análisis va a ser genérico.
- **`registrar_aprendizaje`** — agrega una entrada al log de decisiones. **Solo
  append, solo al final.** Nada reescribe ni borra las secciones de criterios: eso
  lo edita únicamente el usuario.

El filtro contra el ruido son **tres campos obligatorios**: `decision`,
`razonamiento` y `queLaInvalidaria`. El tercero es el que hace el trabajo — si no
se puede articular una condición observable que invalidaría la decisión,
probablemente sea una observación de conversación y no un criterio duradero. La
tool rechaza la entrada y no escribe nada.

El `SYSTEM_PROMPT` instruye a llamar a `perfil_inversor` antes de cualquier lectura
interpretativa, a decir explícitamente cuando una recomendación contradice un
criterio del perfil (en vez de acomodar la respuesta), y a mostrarle al usuario qué
se registró cada vez que escribe.

## Consecuencias y límites

- **Límite — el riesgo de ruido se mitiga, no se elimina.** Los tres campos
  obligatorios y la instrucción de "ante la duda, no registres" reducen el
  problema, pero el modelo sigue decidiendo qué merece guardarse. Conviene revisar
  el log cada tanto y borrar lo que sobre. Si en unos meses el archivo es ilegible,
  la respuesta es quitar la tool de escritura, no seguir ajustando el prompt.
- **Límite — el perfil no está versionado.** Al estar fuera del repo, no hay
  historial ni forma de revertir una edición. El modo `append` acota el daño
  posible de una escritura mala a una entrada suelta.
- **Límite — la ruta se resuelve contra `process.cwd()`.** Funciona porque el
  cliente MCP arranca el server desde la raíz del proyecto. Si alguna vez se
  invoca desde otro directorio, no encuentra el archivo (y lo reporta como
  inexistente, que es el caso benigno).
- **Límite — el perfil es texto libre.** Nada valida que las secciones existan o
  tengan sentido; el modelo lee lo que haya.
- **Límite — es memoria de un solo usuario.** No hay separación por perfil ni
  soporte para más de una cartera.
- **Revisar si:** el log se llena de entradas que no son criterios (señal de que el
  filtro de tres campos no alcanza); o si el usuario termina editando el archivo a
  mano más seguido de lo que el modelo registra bien, que indicaría que la
  escritura automática no está aportando.
