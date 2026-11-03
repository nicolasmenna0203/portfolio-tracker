---
numero: 0011
titulo: Calcular la TIR con Newton-Raphson y varias semillas
estado: Aceptada
fecha: 2026-08-06
codigo: lib/finance.ts
---

# 0011 — Calcular la TIR con Newton-Raphson y varias semillas

## Contexto

El KPI de TIR anual mide el rendimiento de la cartera teniendo en cuenta *cuándo*
entró cada peso: aportes en fechas irregulares más el valor actual de la cartera como
flujo terminal. Eso es una XIRR (TIR de flujos con fechas arbitrarias), no un
rendimiento simple.

La XIRR no tiene solución cerrada: es la raíz de un polinomio en la tasa, y se resuelve
numéricamente. El método estándar, Newton-Raphson, converge rápido pero **depende del
punto de partida**: con una semilla mala puede divergir, oscilar o irse a una tasa sin
sentido económico, incluso cuando existe una raíz válida.

## Alternativas descartadas

- **Newton-Raphson con una sola semilla** (lo habitual, típicamente 0,1) — falla en
  series con tasas muy altas o negativas. En una cartera argentina con aportes en pesos
  eso no es un caso raro.
- **Bisección** — converge siempre dentro de un intervalo con cambio de signo, pero
  hace falta acotarlo de antemano y es mucho más lento.
- **Una librería de finanzas** — para 35 líneas de código bien entendidas, agrega
  dependencia sin resolver nada que no esté resuelto acá.
- **Rendimiento simple** (`valor_final / aportes − 1`) — ignora las fechas: trata igual
  un aporte de hace tres años y uno del mes pasado. Ese número ya existe como
  "rendimiento neto"; la TIR es justamente la métrica que sí pondera el tiempo.

## Decisión

Newton-Raphson con **cinco semillas** probadas en orden —`0.1, 0.5, -0.1, 1.0, 2.0`—
devolviendo la primera que converge. Cubren el rango realista: tasas moderadas,
altas (típicas en pesos), negativas y muy altas.

Parámetros: hasta 200 iteraciones por semilla, tolerancia de 1e-8 sobre el cambio de
`r`, y corte temprano si la derivada se hace ~0 (1e-12), si `r` deja de ser finito o si
cae por debajo de −1 (una tasa menor a −100% no tiene sentido económico).

Los años son **fraccionarios de 365,25 días**, para promediar el efecto de los años
bisiestos sin llevar un calendario.

Convención de signos, desde la perspectiva del inversor: **aportes negativos** (plata
que salió del bolsillo), **retiros y valor terminal positivos**.

Si ninguna semilla converge, devuelve `null` — nunca un número inventado. Quien lo
consume tiene que manejar el `null` mostrando "sin dato".

## Consecuencias y límites

- **Límite — puede devolver `null`.** Es un resultado válido, no un bug: hay series de
  flujos para las que no hay raíz única o el método no converge.
- **Límite — con múltiples cambios de signo puede haber varias raíces** matemáticamente
  válidas. La función devuelve la primera que encuentra, que depende del orden de las
  semillas. Para una cartera de aportes netos positivos y un valor terminal el caso es
  benigno, pero no está garantizado en general.
- **Límite — 365,25 días es una aproximación.** Para períodos cortos introduce un error
  pequeño frente a un calendario real.
- **Límite — la TIR depende del valor terminal**, que se actualiza con los precios de
  mercado: el número se mueve todos los días aunque no haya flujos nuevos.
- **Revisar si:** aparecen series que devuelven `null` de forma consistente (ahí conviene
  agregar semillas o un fallback por bisección).
