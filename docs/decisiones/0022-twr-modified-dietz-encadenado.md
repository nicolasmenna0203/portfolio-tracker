---
numero: 0022
titulo: TWR por Modified Dietz encadenado, unificado entre UI y MCP
estado: Aceptada
fecha: 2026-10-25
codigo: lib/twr.ts, lib/periodo.ts, lib/sheets.ts, lib/parser.ts, lib/agentTools.ts, components/BenchmarksTab.tsx, components/Dashboard.tsx
---

# 0022 — TWR por Modified Dietz encadenado, unificado entre UI y MCP

## Contexto

Una auditoría de toda la estructura de rendimiento (Resumen, Benchmarks, MCP)
encontró que **"Mi Cartera" en la pestaña Benchmarks y la tool `comparar_benchmarks`
del MCP mostraban dos números distintos bajo el mismo nombre**, contradiciendo el
[ADR 0013](0013-benchmarks-incluyen-aportes.md) (reemplazado por este):

- La UI (`BenchmarksTab.tsx`) ya tenía un TWR casero: encadenaba
  `(total_fin − aportes_del_mes) / total_inicio` mes a mes, sin pesar el flujo
  por la fecha exacta dentro del mes — una aproximación más cruda que Modified
  Dietz, que además no estaba documentada como tal en ningún ADR.
- El MCP (`comparar_benchmarks`) rebaseaba el total crudo de la cartera a 100,
  **incluyendo aportes**, como documentaba el ADR 0013.

Ninguna reconciliación contra una referencia externa (TWR real reportado por el
bróker) es posible sin ese número de otra fuente, pero el objetivo acá no era
esa reconciliación — fue notar que ninguna de las dos series es "rendimiento
puro" de forma consistente entre sí, y que el usuario (o el modelo vía MCP) podía
leer "Mi Cartera: 150" en un lugar y un número distinto en el otro sin ninguna
señal de que miden cosas diferentes.

Tampoco existía ningún KPI de TWR en Resumen: "Rendimiento Neto" es una ganancia
simple (`valuación − aportes acumulados`), no ponderada por tiempo, y la TIR
(XIRR) es money-weighted — ninguna de las dos aísla el rendimiento de mercado
puro de cuándo entró cada peso.

Las valuaciones del Sheet son **mensuales**, no diarias: no hay forma de calcular
un TWR exacto (que requiere revaluar en cada fecha de flujo). Los 94 movimientos
sí tienen fecha exacta.

## Alternativas descartadas

- **TWR diario real** — pediría valuar la cartera en cada fecha de movimiento,
  que no existe (el Sheet es mensual). Implicaría interpolar precios de cada
  posición entre cortes, mucho más trabajo para una precisión que los datos no
  sostienen.
- **Mantener la aproximación sin pesar por fecha** (la que ya tenía
  BenchmarksTab) — más simple, pero menos precisa que Modified Dietz y ya
  estaba divergiendo del número del MCP. No valía la pena mantener dos
  aproximaciones distintas cuando una (Modified Dietz con fechas exactas) es
  estrictamente mejor con el mismo costo de implementación.
- **Dejar que cada consumidor (UI, MCP) calcule su propio TWR** — es la causa
  del problema que motivó este ADR. Un solo módulo (`lib/twr.ts`) y un solo
  punto de cálculo (`lib/sheets.ts`, pegado a `resumenSeries`) evita que vuelvan
  a divergir.

## Decisión

TWR = Modified Dietz encadenado mes a mes, con los flujos de los 94 movimientos
ponderados por los días exactos que estuvieron invertidos dentro de cada mes
(`lib/twr.ts`, `construirTWR`). Se calcula una sola vez en `fetchDashboardData()`
y se pega a cada `ResumenRow` (`twrIndiceUsd`, `twrIndiceArs`); todo lo demás
(BenchmarksTab, `comparar_benchmarks`, el KPI de Resumen) lee ese mismo índice en
vez de recalcularlo.

```
r_mes = (valorFin − valorInicio − Σflujos) / (valorInicio + Σ(flujo × peso))
peso = días restantes del mes después del flujo / días del mes
índice = índice_anterior × (1 + r_mes)
```

Se calcula en **USD** (valuaciones y flujos en `monto_usd`/`total_cartera`) y en
**ARS** (en `monto_ars`/`total_cartera_ars`, MEP del día exacto de cada flujo —
mismo criterio que [0007](0007-mep-mensual-no-mep-unico.md)). Es una
aproximación, no un TWR diario exacto: se declara así en el tooltip ⓘ de
Resumen y de Benchmarks.

**Un flujo clasificado `interno`** (traspaso entre cuentas propias, ver tipo
`MovimientoRow.clasificacion`) sigue siendo un flujo para Modified Dietz — se
neutraliza igual que cualquier otro. La clasificación solo afecta la métrica
"Ganancia Acumulada" (`lib/periodo.ts`), que resta nada más los aportes
`externo` del período: mover plata de un bróker a otro no es capital aportado.

La lista de traspasos va en la env var `MOVIMIENTOS_INTERNOS`
(`"YYYY-MM-DD:monto_usd"` separados por coma), no en el código: son fechas y
montos de operaciones reales y el repo es público. Sin la variable, todos los
movimientos quedan como `externo`, que es el default correcto.

Resumen agrega un selector de período (1 mes / YTD / 12 meses / Máximo,
`lib/periodo.ts`) que recorta la serie y recalcula TWR, ganancia y TIR sobre el
tramo elegido — la TIR del período toma el valor de cartera al arranque del
tramo como flujo inicial (un "aporte implícito" de lo que ya estaba invertido),
forma estándar de acotar una XIRR a una ventana.

## Consecuencias y límites

- **Límite — es una aproximación mensual, no un TWR diario.** Un movimiento
  grande a mitad de mes con un salto de precio fuerte el mismo día no se
  captura con precisión: Modified Dietz asume rendimiento uniforme dentro del
  mes.
- **Límite — ARS ≠ USD × MEP de forma exacta cuando hay flujos.** El flujo
  convierte al MEP de su día exacto, mientras el stock de cada mes usa un MEP
  único para todo el mes: son dos cortes de tiempo distintos. Sin flujos la
  identidad es exacta (hay test). Con flujos el desacople es de **varios
  puntos**, no de décimas: sobre la serie real da ~7. Un primer test lo medía
  contra una devaluación suave (~3% mensual) y daba <1 punto, lo que escondía
  el problema — el MEP real salta ±20-30% mes a mes. El test ahora usa esa
  volatilidad y verifica un rango, no una precisión que los datos no sostienen.
- **Límite — el primer mes de la serie no entra en la cadena.** El índice
  arranca en 100 por definición, así que el rendimiento del mes inicial no se
  captura. Arrancar un mes después mueve el acumulado ~4,5 puntos.
- **Límite — la calidad del TWR en ARS depende de que la columna `Tenencia
  (ARS)` del Sheet esté bien cargada.** Cinco filas tenían ahí el monto en
  dólares (cargadas a mano desde la columna "TOTAL EN MONEDA" del PDF en vez de
  "TOTAL ARS"), y `parseFloat` las leía como pesos sin avisar: el TWR en ARS
  daba 77,4% en vez de 85,2%, con un falso −28% en un mes. `parseArgNum` ahora
  rechaza cualquier valor con texto pegado en vez de adivinar.
- **Límite — TWR y TIR miden cosas distintas a propósito.** No son
  intercambiables ni promediables entre sí. El SYSTEM_PROMPT del MCP lo aclara
  para que el modelo no las mezcle.
- **Reemplaza a [0013](0013-benchmarks-incluyen-aportes.md)**, que documentaba
  que la serie de benchmarks incluía aportes — ya no es así: ahora es TWR en
  los dos lugares (UI y MCP).
- **Revisar si:** el Sheet alguna vez pasa a tener valuaciones diarias (ahí se
  puede calcular un TWR exacto en vez de la aproximación mensual); o si
  aparece una reconciliación confiable contra el TWR que reporta el bróker
  para medir el error real de la aproximación.
