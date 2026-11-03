---
numero: 0013
titulo: La serie de la cartera en benchmarks incluye aportes, y hay que decirlo
estado: Reemplazada por 0022
fecha: 2026-08-06
codigo: lib/benchmarks.ts, lib/agentTools.ts
---

> **Reemplazada por [0022](0022-twr-modified-dietz-encadenado.md).** La serie de
> la cartera en Benchmarks y en `comparar_benchmarks` dejó de incluir aportes:
> ahora es TWR (Modified Dietz encadenado) en los dos lugares. Este documento
> queda como historia de por qué la decisión original fue mostrar el total
> crudo con advertencia, en vez de restar los aportes.

# 0013 — La serie de la cartera en benchmarks incluye aportes, y hay que decirlo

## Contexto

La tab de benchmarks compara la cartera contra S&P 500, inflación, dólar MEP,
Bitcoin y oro, todos rebasados a índice 100 desde el inicio de la serie.

La cartera recibe aportes mensuales. Su valor total crece por dos motivos
—rendimiento y plata nueva— mientras los benchmarks crecen solo por rendimiento. Si
se grafica el valor total de la cartera contra ellos en base 100, la cartera "le gana"
a todo por goleada, y el gráfico no significa nada: la mayor parte de la diferencia es
el dinero aportado, no la performance.

Es la clase de error que se ve bien en pantalla y lleva a conclusiones falsas ("mi
cartera rindió 300%").

## Alternativas descartadas

- **Restar los aportes de la serie** — para hacerlo bien hace falta una serie
  time-weighted o money-weighted (TWR / MWR) calculada sobre los flujos, no una
  resta simple. Es una feature en sí misma, no un ajuste al gráfico.
- **No mostrar la cartera en el gráfico** — deja los benchmarks sin referencia y
  quita el sentido de la tab.
- **Mostrar solo la TIR contra los benchmarks** — la TIR ya está en el KPI de
  resumen, y es un número puntual: no permite ver la trayectoria ni cuándo se
  separó de cada índice.

## Decisión

Se muestra la serie del valor de la cartera rebasada a 100, junto a los benchmarks, y
**la limitación se declara explícitamente** en los tres lugares donde alguien puede
leer el número:

- en la UI de la tab,
- en la descripción de la tool `comparar_benchmarks`,
- en el `SYSTEM_PROMPT` de `lib/agentTools.ts`, con la instrucción de derivar a
  `resumen_cartera` o `evolucion_mensual` cuando la pregunta sea sobre rendimiento
  puro.

Los benchmarks son **índices base 100, no precios**: el valor de la serie no es la
cotización del activo.

Para medir rendimiento real, la fuente correcta es el KPI de rendimiento neto
(`total_cartera − aportes_acumulados`) y la TIR anual, que sí descuentan los flujos
→ [0011](0011-xirr-newton-raphson-multi-semilla.md).

## Consecuencias y límites

- **Límite — el gráfico no responde "¿le gané al mercado?".** Responde "cómo creció
  mi patrimonio contra cómo crecieron estos índices", que es otra pregunta. Cualquier
  lectura de outperformance sacada de ahí es inválida.
- **Límite — la advertencia depende de que se lea.** Es la mitigación más débil de
  todo el sistema: un screenshot del gráfico pierde el contexto. Por eso está
  repetida en UI, tool y prompt.
- **Límite — inflación y MEP no son activos invertibles.** Están como referencia de
  poder adquisitivo y de tipo de cambio, no como alternativas de inversión con
  rendimiento comparable.
- **Revisar si:** se implementa TWR o MWR sobre los flujos — ahí la serie de la
  cartera pasa a ser comparable de verdad y este ADR queda reemplazado.
