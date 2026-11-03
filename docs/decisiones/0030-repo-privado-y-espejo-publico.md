---
numero: 0030
titulo: Desarrollar en un repo privado y publicar un espejo sin historia, con lo que delata la cartera en el Sheet
estado: Aceptada
fecha: 2026-11-03
codigo: scripts/publicar-espejo.ts, lib/bonosProvinciales.ts, lib/tickersEspeciales.ts, lib/bonosArg.ts, lib/bondMetrics.ts, lib/tickersElegibles.ts, lib/demo/universo.ts, components/Dashboard.tsx, .github/workflows/alerta-semanal.yml
---

# 0030 — Desarrollar en un repo privado y publicar un espejo sin historia, con lo que delata la cartera en el Sheet

## Contexto

El repo era público y una auditoría encontró que la cartera se filtraba sin que
ningún archivo dijera un monto. La historia de git tenía versiones anteriores de
archivos ya limpiados (nombre del broker, archivos de perfil borrados después).
Y el código mismo tenía listas que existían porque esos activos estaban en la
cartera: las condiciones de los bonos con TIR propia, los tickers con excepción
de cotización, el mapeo de bonos a bonistas (que coincidía uno a uno con el
historial de bonos de la hoja Activos), y un universo de demo con una docena de
tickers que también estaban ahí. Limpiar el árbol actual no alcanzaba: lo que
filtraba era *qué* había en una lista, no un número.

## Alternativas descartadas

- **Reescribir la historia con `git filter-repo` y hacer force push** — saca los
  archivos viejos del repo, pero no de los clones que ya existan ni de los
  commits que GitHub sigue sirviendo por SHA durante un tiempo. Y no resuelve
  las listas del código actual, que se volverían a publicar en el commit
  siguiente.
- **Parchear solo la copia pública** (reemplazar esos archivos al exportar) — el
  privado y el público divergen, cada exportación tiene que reaplicar los
  parches y el código público no es el que corre en producción.
- **Variables de entorno para las listas** (como `MOVIMIENTOS_INTERNOS`) — hay
  que mantenerlas en tres lugares (Vercel, `.env` local, el MCP), y las
  condiciones de un bono con amortizaciones escalonadas no entran cómodas en un
  string.
- **Reemplazar el mapeo de bonos por una regla** (prefijo AL/GD/AE + "D") —
  pierde la garantía de match exacto contra bonistas: un ticker mal mapeado
  muestra el flujo de otro bono, y esa garantía es la razón de ser del mapeo.

## Decisión

**Dos repos.** El que tiene la historia pasa a privado
(`portfolio-tracker-privado`) y es donde se desarrolla y desde donde despliega
Vercel. El público (`portfolio-tracker`) es un espejo sin historia:
`scripts/publicar-espejo.ts` exporta `HEAD` del privado, lo escanea y lo
commitea como un commit nuevo del espejo. El script se queda en el privado, no
se exporta: su lista de excepciones diría qué tickers son reales.

**El escaneo bloquea la publicación** si encuentra algún ticker o nombre de
fondo de las hojas del Sheet (Activos, FondosCAFCI, BonosCalculoPropio,
TickersEspeciales) fuera de las listas genéricas de mercado, o algún término de
`.publicar-prohibidos` (archivo local, fuera del repo: nombres de broker, banco,
personas). Como lee el Sheet en vivo, un activo nuevo queda cubierto sin tocar
el script.

**Lo que delata la cartera va al Sheet**, con el mismo patrón que ya tenía
`FondosCAFCI`:

- `BonosCalculoPropio` — condiciones de cada bono con TIR propia (ver
  [0001](0001-tir-duration-propias-bonos-provinciales.md)). La migración se
  verificó comparando la salida del módulo viejo y la del nuevo leyendo la hoja:
  idéntica en tres fechas distintas.
- `TickersEspeciales` — `COTIZA` (tiene símbolo en Yahoo aunque su TIPO no pase
  el filtro; llega al cliente como `cotizaEnMercado` en cada tenencia) y
  `EXCLUIR_BONO` (no se muestra en la curva de bonistas).

**Las listas que tienen que quedar en el código pasan a ser universos
completos**, no subconjuntos: el mapeo de bonos es todo el universo del Tesoro
con pagos próximos en bonistas (62 bonos) y el mapa de alias cubre las acciones
con clase más conocidas. Una lista completa no dice qué se tiene.

**La demo no tiene tickers de la cartera y muestra los montos ocultos**
(`valoresSiempreOcultos` en `<Dashboard>`): aunque los datos sean sintéticos, la
demo se muestra a terceros.

## Consecuencias y límites

- **Límite — lo que ya se publicó no vuelve.** La historia vieja estuvo
  pública: cualquier clone previo la conserva. Esto evita filtraciones nuevas,
  no deshace las anteriores.
- **Límite — el espejo atrasa.** Solo se actualiza cuando se corre el script; no
  hay sincronización automática, a propósito: publicar es un acto explícito.
- **Límite — dos especies del mismo bono pueden verse como puntos separados en
  la curva** (ej. el Par o el Discount ley Arg en sus dos especies): con el
  mapeo completo, cada especie mapeada se salva de la deduplicación por
  vencimiento de `bondMetrics.ts`. Son instrumentos que cotizan por separado,
  así que el dato no es falso, pero la curva tiene un punto más.
- **Límite — el mapeo de bonos es una foto.** Un bono que salga a mercado
  después del 2026-11-03 no tiene cronograma ni precio "D" hasta que se agregue,
  con el mismo criterio de match exacto.
- **Límite — el escaneo no entiende contexto.** Bloquea por ticker o término
  literal; una descripción en prosa de la cartera ("tengo tres fondos") no la
  ve. Sigue valiendo la regla de [CLAUDE.md](../../CLAUDE.md) al escribir.
- **Revisar si:** el espejo deja de tener sentido (ahí alcanza con borrarlo); o
  si aparece otra lista en el código que exista porque esos activos están en la
  cartera — va al Sheet, no al escaneo.
