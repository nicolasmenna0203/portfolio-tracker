---
numero: 0007
titulo: Valuar en pesos con el MEP de cada fecha, no con un MEP único
estado: Aceptada
fecha: 2026-08-06
codigo: lib/sheets.ts, lib/precios.ts, lib/benchmarks.ts, scripts/backfill-ars.ts
---

# 0007 — Valuar en pesos con el MEP de cada fecha, no con un MEP único

## Contexto

El dashboard muestra todo con un toggle USD/ARS. Las tenencias se registran en USD,
así que la vista en pesos requiere un tipo de cambio. En un país con inflación alta y
un tipo de cambio que se multiplicó a lo largo de la serie histórica, la elección de
*cuál* MEP usar no es un detalle de presentación: define si los números en pesos
significan algo.

Con un MEP único (por ejemplo el de hoy) aplicado a toda la serie, la evolución en
pesos sería idéntica en forma a la de dólares, solo reescalada. Los aportes de hace
dos años aparecerían valuados al tipo de cambio de hoy, mostrando un monto que nunca
se aportó.

## Alternativas descartadas

- **Un MEP único para toda la serie** — convierte la vista en pesos en una copia
  reescalada de la de dólares: no aporta información y muestra aportes históricos a
  valores que nunca existieron.
- **MEP de cierre de mes para todo, incluidos los aportes** — mejor que lo anterior,
  pero introduce un error en los flujos: un aporte hecho el día 3 se valúa al tipo de
  cambio del día 30.
- **Convertir en el momento de la lectura, en el cliente** — obligaría a traer una
  serie histórica de MEP a cada render y a recalcular todo en el browser.

## Decisión

Dos reglas distintas según qué se valúa:

- **Tenencias (stock):** cada mes usa el MEP **de ese mes**. La columna `Tenencia
  (ARS)` del Sheet ya viene calculada así, y las cargas por PDF toman el MEP que
  informa el resumen del propio mes.
- **Movimientos (flujo):** cada aporte usa el MEP del **día exacto** del movimiento
  (`lib/sheets.ts`, columna `Monto (ARS)`). Es más preciso para agregar aportes, que
  es lo que alimenta el KPI de aportes acumulados y la TIR.

La fuente del MEP histórico es ArgentinaDatos, con **fallback al día hábil anterior
más cercano** cuando la fecha pedida no tiene cotización (fines de semana, feriados).
El MEP spot se cachea; el histórico se resuelve por fecha en `lib/benchmarks.ts`
(`fetchMepPorFecha`), reutilizado por `scripts/backfill-ars.ts`.

## Consecuencias y límites

- **Límite — la serie en ARS no es la de USD reescalada**, y sus variaciones
  porcentuales no coinciden. Es correcto: incluye el movimiento del tipo de cambio.
  Es el mismo principio que [0003](0003-variacion-semanal-por-moneda-nativa.md).
- **Límite — los valores en ARS son nominales, no ajustados por inflación.** Un
  crecimiento en pesos no implica ganancia de poder adquisitivo. El dashboard no
  deflacta: para eso está la comparación contra inflación en benchmarks.
- **Límite — el MEP se toma del cierre del día** (o del día hábil anterior), no del
  momento exacto de la operación.
- **Límite — depende de una única fuente pública** para el MEP histórico. Si
  ArgentinaDatos cambia de formato o cae, la valuación en ARS de datos nuevos se
  degrada.
- **Revisar si:** se quiere una vista ajustada por inflación (sería otra decisión, no
  un cambio de esta); o si hace falta una segunda fuente de MEP como respaldo.
