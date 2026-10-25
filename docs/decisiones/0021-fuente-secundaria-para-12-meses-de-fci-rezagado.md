---
numero: 0021
titulo: Completar el 12 meses de un FCI rezagado con un espejo histórico, no mes ni año
estado: Aceptada
fecha: 2026-10-25
codigo: lib/fciHistorico.ts, lib/fciCocos.ts
---

# 0021 — Completar el 12 meses de un FCI rezagado con un espejo histórico, no mes ni año

## Contexto

[0019](0019-sin-dato-no-es-cero-en-rendimientos-de-fci.md) resolvió que un
rendimiento que CAFCI no publica para un fondo rezagado se muestre "s/d" en vez
de 0,0%. La pregunta que quedó abierta es si "s/d" es el final del camino o si
hay otra fuente que sí tenga el dato.

`api.pub.cafci.org.ar/pb_get` (la Planilla Diaria, ver
[0005](0005-parsear-cafci-con-zlib-nativo.md)) es un snapshot: siempre devuelve
la foto de hoy, sin parámetro de fecha que cambie la respuesta (`?fecha=`,
`?date=`, `?d=` probados — exactamente los mismos bytes). No hay forma de
pedirle el VCP de una fecha pasada.

Existe sin embargo `api.argentinadatos.com/v1/finanzas/fci/{categoria}/{anio}/{mes}/{dia}`
— la misma API que ya usa `lib/precios.ts` para el MEP — con un endpoint por
fecha. Es un espejo de la misma planilla CAFCI, no una fuente independiente: en
los días que tiene la fila completa, el VCP coincide al centavo con lo que
publica CAFCI. Pero sí permite mirar hacia atrás.

El espejo es irregular: la mayoría de los días devuelve apenas unas pocas filas
(un scrape parcial, no "casi no hubo operaciones"), y encontrar el día exacto
que se busca casi nunca funciona a la primera. Relevado contra el fondo rezagado
real del momento (Cocos Dólares Plus — Clase A, USD):

- Snapshot completo (~1800-1940 fondos) en algunos días sueltos: 22/10, 15/10,
  30/10 del año anterior, 27/10, 24/10, 21/10 del año anterior, etc.
- Snapshot parcial (1 a 70 filas) en la mayoría de los días intermedios.
- El hueco típico alrededor de un cierre de mes es de 2-3 semanas completas: la
  ventana del 27/09 al 03/10 de este año, por ejemplo, no tuvo un solo día con
  snapshot completo.
- El hueco alrededor de un cierre de año calendario es más chico (unos pocos
  días) pero tampoco cae justo en la fecha de cierre.
- Buscando ±5 días desde la fecha exacta de "hace 12 meses", en el caso real
  relevado el punto exacto (offset 0) estuvo disponible.

## Alternativas descartadas

- **Pedirle a la API autenticada de CAFCI la serie del fondo**
  (`api.cafci.org.ar/fondo/{id}/clase/{id}/serie`) — devuelve 401 sin
  documentación de auth, el mismo límite que ya descartó 0005 para la planilla
  completa.
- **Completar también mes y año con el mismo mecanismo** — el hueco alrededor
  de esos cierres es de 2-3 semanas, demasiado grande para que "el punto más
  cercano dentro de la tolerancia" siga significando lo mismo que "cierre de
  mes". Forzarlo daría un número con una ventana notoriamente distinta de la
  que usan los otros tres fondos de la cartera, que sí tienen la ventana exacta
  de CAFCI — exactamente el problema que [0004](0004-grupos-de-bono-y-tir-no-comparables.md)
  ya documentó para TIR de bonos: una métrica con ventana distinta no es
  comparable aunque tenga el mismo nombre de columna.
- **Reconstruir una serie propia guardando snapshots diarios** — resuelve el
  problema de fondo (tener historia real, no depender de que el espejo tenga
  justo ese día), pero es infraestructura nueva con su propio estado, y no
  resuelve el presente: los primeros 12 meses de acumulación seguirían sin
  dato.
- **Aceptar cualquier punto sin tolerancia de días** — ya cubierto arriba,
  descartado por desalinear la ventana.
- **Ampliar la tolerancia más allá de 5 días para cubrir también mes/año** — la
  ventana exacta importa más cuanto más corto es el período que se mide: un
  error de 5 días sobre un año es ~1,4% del período, sobre un mes es ~17%.

## Decisión

`lib/fciHistorico.ts` expone `rendimiento12MesesVia(categoria, nombreFondo,
vcpHoy, fechaHoy)`: calcula `vcpHoy / vcpHaceUnAño − 1` buscando el VCP de hace
12 meses en el espejo, probando primero la fecha exacta y alejándose un día a
la vez hacia ambos lados hasta `TOLERANCIA_DIAS = 5`. Descarta cualquier
snapshot con menos de `FILAS_MINIMAS_SNAPSHOT_COMPLETO = 500` filas: un día con
pocas filas no es que el universo de FCI casi no operó, es que el scrape de esa
fuente no llegó a guardar el resto.

`fciCocos.ts` lo usa solo como respaldo: después de parsear la planilla, para
cada ticker en `CATEGORIA_HISTORICO` cuyo `rendimiento12Meses` haya quedado
`null` (columna vacía por rezago), intenta completarlo. Si lo logra, marca
`rendimiento12MesesEstimado: true` en `FciMetric`. **Mes y año no se tocan**:
siguen en `null` si CAFCI no los publica, por el hueco de cobertura descripto
arriba.

La UI (`FciSection.tsx`) y el MCP (`renta_fija_fci`) muestran el 12 meses
estimado con una marca distinta ("~" en la UI, `rendimiento_12m_estimado` en el
MCP) y una aclaración de que no es la cifra que publica CAFCI para el resto de
los fondos.

`CATEGORIA_HISTORICO` solo mapea los tickers que hoy pueden llegar a necesitarlo
(no todo `MAPEO_FCI_COCOS`): agregar un ticker ahí no cambia nada si CAFCI ya lo
publica completo, así que no hay costo en dejarlo vacío para los fondos que
nunca tuvieron el problema.

## Consecuencias y límites

- **Límite — el 12 meses estimado depende de que el espejo tenga, por
  casualidad, un snapshot completo dentro de ±5 días de la fecha exacta.** No
  hay garantía: puede dar "s/d" en vez de un número, sin patrón predecible de
  cuándo. El relevamiento de este ADR encontró el punto exacto para un caso
  real, pero no es una propiedad garantizada de la fuente.
- **Límite — la categoría de `argentinadatos` es un dato de esa API, no de
  CAFCI**, y puede no coincidir con el `horizonte` que CAFCI le asigna al mismo
  fondo. Si `argentinadatos` reclasifica un fondo a otra categoría, el mapeo en
  `CATEGORIA_HISTORICO` queda desactualizado y el completado deja de encontrarlo
  (vuelve a "s/d", no rompe nada, pero pierde cobertura en silencio).
- **Límite — sigue siendo la misma fuente primaria (CAFCI) mirada con rezago**,
  no una fuente independiente que permita auditar a CAFCI. Un error en la
  planilla de CAFCI se propaga igual a esta estimación.
- **Límite — mes y año quedan sin resolver.** Un fondo rezagado sigue mostrando
  "s/d" en esas dos columnas aunque tenga el 12 meses completo; es la limitación
  descripta arriba, no un olvido.
- **Revisar si:** el espejo deja de tener puntos completos con la frecuencia
  relevada acá (si la cobertura empeora, la tolerancia de 5 días puede dejar de
  alcanzar y habría que decidir si ampliarla o abandonar el mecanismo); o si
  CAFCI empieza a dejar de publicar la columna de 12 meses más seguido (ahí el
  costo de mantener esta fuente secundaria crece).
