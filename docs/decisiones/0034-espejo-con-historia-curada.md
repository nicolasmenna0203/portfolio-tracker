---
numero: 0034
titulo: Publicar en el espejo la historia del repo privado desde la limpieza, commit por commit
estado: Aceptada
fecha: 2026-11-10
codigo: scripts/publicar-espejo.ts
---

# 0034 — Publicar en el espejo la historia del repo privado desde la limpieza, commit por commit

Reemplaza a [0030](0030-repo-privado-y-espejo-publico.md). Se mantiene lo que
decidía: dos repos (el privado donde se desarrolla y despliega Vercel, el
público como espejo), el escaneo que bloquea la publicación, las listas que
delatan la cartera en el Sheet o convertidas en universos completos, y la demo
con los montos siempre ocultos. Cambia que el espejo ya no es un commit-foto
por publicación.

## Contexto

El 0030 publicaba `HEAD` como un commit nuevo cada vez, con el mismo mensaje y
solo la fecha distinta. Es seguro, pero el repo público no cuenta nada: no se
ve qué cambió ni por qué, y no se lee como un proyecto con historia. Lo que
forzó ese diseño fue la historia anterior a `27bf09e` (ver el 0030), que tiene
versiones viejas de archivos con datos de la cartera. Desde ese commit, el
código ya se escribió bajo las reglas actuales, con mensajes `tipo: descripción`
en español, así que esa parte sí se puede publicar.

## Alternativas descartadas

- **Seguir con un commit-foto por publicación** — es lo que había: no filtra
  nada, pero el espejo pierde el motivo de cada cambio, que es lo que busca
  quien lee un repo público.
- **Publicar toda la historia del privado** — reabre la filtración del 0030:
  versiones viejas con el nombre del broker, archivos de perfil y las listas
  que existían por la cartera.
- **Reescribir la historia anterior con `git filter-repo`** — los mismos
  problemas del 0030: no alcanza a los clones ya hechos y obliga a cambiar
  cada commit viejo con arreglos que no son locales.
- **Escribir a mano commits temáticos para el espejo** — quedaría más legible,
  pero es una historia inventada: no se corresponde con el privado y no se
  puede verificar qué se agrupó.
- **Escanear solo el último árbol de cada tanda** — lo que estuvo en un commit
  intermedio queda público aunque el siguiente lo corrija (por ejemplo, un
  ticker real en un test que se cambia dos commits después).
- **Fusionar con el commit que lo arregla los intermedios que el escaneo
  bloquea** — da commits grandes que mezclan temas y rompe la correspondencia
  uno a uno con el privado.

## Decisión

`npm run publicar` reproduce en un clon del espejo cada commit del privado
posterior al último publicado, con su fecha original y su mensaje, y publica
solo si todos pasan el escaneo.

- **Punto de partida (`BASE`)**: el commit del privado donde el código quedó
  limpio. Es el primer commit del espejo, como "versión inicial pública"; lo
  anterior no se publica.
- **Estado**: el tag `espejo-publicado` marca el último commit del privado
  ya publicado; sin él hace falta `--reiniciar`, que rehace la historia desde
  `BASE` y la sube con `--force-with-lease`.
- **Qué se escanea**: el árbol completo de cada commit (no solo el último) y su
  mensaje. Al mensaje se le suman dos reglas: el asunto sigue
  `tipo: descripción` y no hay referencias `#N`, que en el espejo apuntarían a
  otra cosa.
- **Sustituciones** (`.publicar-sustituciones`, local): cuando un commit del
  privado usaba un valor que el escaneo prohíbe y un commit posterior lo
  cambió por uno sintético, se aplica ese cambio, en ese archivo, a todos los
  commits del tramo. El commit que solo hacía ese cambio queda vacío y se
  omite. Es por archivo y no global porque el mismo valor puede ser legítimo en
  otro (una lista de universo): un reemplazo global lo habría corrompido.
- **Mensajes propios** (`.publicar-mensajes.json`, local): para publicar un
  commit con otro texto que el original, cuando el cuerpo cuenta detalle de la
  serie real o cita PRs del privado.
- **Autor**: siempre `ESPEJO_AUTOR`; los commits privados llevan un mail real.

## Consecuencias y límites

- **Límite:** el escaneo de mensajes no entiende prosa, igual que el de
  archivos. Antes de subir hay que leer los mensajes que imprime la corrida sin
  `--push`; un cuerpo con cifras de la serie real se reescribe en
  `.publicar-mensajes.json`.
- **Límite:** con las sustituciones, el árbol público de un commit no es
  idéntico al privado. Solo cambia el valor sustituido, que no afecta lo que
  corre en producción.
- **Límite:** las fechas originales se conservan, así que el ritmo de trabajo es
  visible en el espejo (ya lo era en el repo anterior).
- **Límite:** se sigue solo el primer padre: un merge se publica como un único
  commit.
- **Límite:** el estado vive en el tag `espejo-publicado` del privado, que el
  script sube a `origin` tras cada publicación. Si se pierde, `--reiniciar`
  rehace el espejo desde `BASE` con un force push.
- **Límite:** los commits-foto anteriores del espejo se descartan con el force
  push. GitHub puede servir esos SHA un tiempo por URL directa, pero ya
  habían pasado el escaneo.
- **Revisar si:** el escaneo de mensajes deja pasar algo en prosa más de una
  vez: ahí conviene publicar solo el asunto de cada commit.
