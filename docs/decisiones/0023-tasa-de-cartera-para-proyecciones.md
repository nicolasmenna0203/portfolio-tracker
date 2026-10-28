---
numero: 0023
titulo: Proyectar con el TWR anualizado de la cartera, y medir la inversión como aportes sobre ingresos
estado: Aceptada
fecha: 2026-10-27
codigo: lib/finanzasPersonales.ts, components/ProyeccionesTab.tsx, components/FlujoMensualResumen.tsx
---

# 0023 — Proyectar con el TWR anualizado de la cartera, y medir la inversión como aportes sobre ingresos

## Contexto

La pestaña Proyecciones usaba una tasa anual elegida a mano con un slider y un
aporte mensual también a mano, sin relación con lo que la cartera rindió ni con
lo que realmente se ahorra. Había dos tasas "de cartera" disponibles en el
dashboard (TWR y TIR, ver [0022](0022-twr-modified-dietz-encadenado.md) y
[0011](0011-xirr-newton-raphson-multi-semilla.md)) y hacía falta decidir cuál
alimenta la fórmula `capital × (1+r) + aporte` mes a mes.

Además, Ingresos, Gastos y Proyecciones eran tres islas: ninguna usaba los
datos de las otras. Los gastos del Sheet son un catálogo de montos mensuales
cargados a mano (recurrentes y estimados), completo solo si el usuario cargó
todo, así que "ingreso − gastos" no es ahorro.

## Alternativas descartadas

- **TIR (XIRR) como tasa de proyección** — es money-weighted: depende de cuándo y
  cuánto se aportó. Un aporte grande y único (venta de un bien, por ejemplo)
  mueve la TIR por el momento en que cayó, no por lo que rindió la cartera. La
  fórmula de proyección ya modela los aportes por separado, así que usar una
  tasa que los lleva incorporados los cuenta dos veces. Queda como referencia
  visible, no como insumo.
- **Una sola ventana (solo histórico completo)** — mezcla períodos en los que la
  composición de la cartera era distinta de la actual, y un historial corto
  exagera cualquier tramo bueno. Se exponen dos ventanas y que elija el usuario.
- **Tasa de cartera como default** — cambiaría en silencio la proyección de quien
  ya tiene una tasa guardada. El modo arranca en "Manual"; las dos opciones
  basadas en la cartera son una elección explícita.
- **Recortar o ajustar por inflación la tasa observada** — no hay un criterio
  defendible para el recorte y una tasa nominal en USD ya es la unidad de la
  proyección. Se muestra la advertencia en vez de maquillar el número.
- **Ahorro = ingreso − gastos** — todo gasto no cargado contaría como ahorro y
  la tasa saldría inflada.
- **Promediar los ratios mensuales** — un mes con ingreso bajo y un
  aporte alto (tasa enorme) pesaría igual que uno normal.

## Decisión

**Tasa de cartera = TWR anualizado en USD** (`tasaCartera` en
`lib/finanzasPersonales.ts`, que reusa `calcularMetricasPeriodo`). Es la tasa
por unidad de capital, independiente de los flujos: justo lo que la proyección
necesita para componer el stock mientras suma aportes aparte. Ventanas: últimos
12 meses y serie completa. Si el tramo tiene menos de 12 meses se avisa que la
anualización extrapola; si supera 25% anual (`TASA_ALTA_PCT`, umbral arbitrario
de aviso, no un dato) se avisa que es un tramo bueno y que sirve de techo.

**Ratio de inversión = Σ aportes netos externos / Σ ingresos**, en meses cerrados con
ingresos cargados, ventana de 6 meses (`VENTANA_MESES`, arbitraria: suaviza sin
arrastrar un ingreso viejo en pesos nominales). "Otros gastos" es el residuo
`ingreso − aporte − gastos`, que la UI llama "sin asignar": gasto sin cargar
más cualquier ahorro que no pasó por la cartera. Los gastos en otra moneda se convierten con el MEP
actual porque el catálogo no tiene fecha (contrasta con
[0007](0007-mep-mensual-no-mep-unico.md), donde cada movimiento sí la tiene).

## Consecuencias y límites

- **Límite — proyectar un rendimiento pasado es una suposición, no un dato.** La
  historia es corta y un tramo de mercado favorable se anualiza igual que uno
  malo. El TWR también hereda las aproximaciones de 0022 (valuación mensual,
  Modified Dietz) y su reconciliación contra un tercero no cerró, así que su
  nivel absoluto es menos firme que su orden de magnitud.
- **Límite — el ratio de inversión cuenta solo lo que entró a la cartera.** Ahorro en
  efectivo o en una cuenta bancaria aparece como "sin asignar". Y un aporte que
  no viene del sueldo infla el ratio de su mes (el gráfico de Ingresos acota la
  escala a 1,3× el mayor ingreso para que un mes así no aplaste el resto; esa
  barra queda cortada y el tooltip lo avisa).
- **Límite — "sin asignar" puede dar negativo** cuando el aporte de un mes se
  fondeó con algo distinto del sueldo; en ese caso no se dibuja el reparto del
  ingreso, porque dejaría de ser un 100%.
- **Límite — la comparación ingreso vs gastos mezcla épocas**: el ingreso es un
  promedio de los últimos meses, los gastos son los de hoy al MEP de hoy.
  Con un MEP volátil (±20-30% mes a mes) el porcentaje es una orden de magnitud.
- **Revisar si:** el Sheet pasa a registrar gasto real por movimiento y no un
  catálogo estimado (ahí el ahorro puede calcularse por el lado del gasto
  y contrastarse con la de aportes); o si la
  reconciliación del TWR contra un tercero cierra y se puede confiar más en su
  nivel absoluto.
