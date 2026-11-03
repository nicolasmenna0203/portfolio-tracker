---
numero: 0006
titulo: Estimar la sensibilidad de la TIR con duration, ignorando convexidad
estado: Aceptada
fecha: 2026-08-06
codigo: lib/performance.ts
---

# 0006 — Estimar la sensibilidad de la TIR con duration, ignorando convexidad

## Contexto

La sección de renta fija muestra cómo cambiaría la TIR de cada bono ante shocks de
precio de 1, 2, 3, 5 y 10%. Es la pregunta práctica de "si este bono se mueve tanto,
¿a qué tasa queda?".

La fuente de datos de bonos publica campos propios de sensibilidad (`tir_up_N` /
`tir_down_N`), así que la opción obvia era usarlos y no calcular nada.

## Alternativas descartadas

- **Los campos `tir_up_N` / `tir_down_N` de la fuente** — descartados: no documentan la
  fórmula y los valores no cuadran ni como TIR resultante absoluta ni como delta sobre
  la TIR base, al contrastarlos con la aproximación estándar. Un número que no se puede
  reproducir ni explicar no se muestra.
- **Recalcular la TIR completa para cada precio shockeado** — es lo exacto, pero
  requiere el flujo de fondos de cada bono. Solo se tiene para los que se calculan
  localmente ([0001](0001-tir-duration-propias-bonos-provinciales.md)); para el resto la
  fuente da TIR y duration, no el cronograma.
- **Duration + convexidad** (aproximación de segundo orden) — más preciso en shocks
  grandes, pero la fuente no publica convexidad. Habría que estimarla, agregando un
  supuesto propio para corregir un supuesto propio.

## Decisión

Aproximación de primer orden vía duration modificada:

```
ΔTIR ≈ Δprecio% / duration_modificada
```

Es la fórmula estándar de renta fija y, a diferencia de los campos de la fuente, su
cálculo es **verificable**: cualquiera puede reproducirla con los dos números que se
muestran en la misma tabla.

Se evalúa en shocks de 1, 2, 3, 5 y 10%, en las dos direcciones. Si la duration no es
positiva, no se devuelve sensibilidad (en vez de dividir por cero).

Los ponderados de TIR y duration se agregan **por grupo de tasa**, nunca sobre el total
→ [0004](0004-grupos-de-bono-y-tir-no-comparables.md).

## Consecuencias y límites

- **Límite — ignora la convexidad**, así que el error crece con el tamaño del shock y en
  bonos de duration muy corta. El shock del 10% es el menos confiable de la tabla.
- **Límite — es lineal y simétrica**: da el mismo salto de TIR para arriba y para abajo.
  En la realidad la relación precio-TIR es convexa, y la caída de precio ante una subida
  de tasas es menor que lo que predice la duration sola.
- **Límite — no es un escenario de tasas.** Modela un shock de **precio** del bono
  individual, no un movimiento de la curva completa ni un cambio de la tasa de
  referencia.
- **Límite — hereda la calidad de la duration de entrada.** Si la duration viene de un
  cálculo propio, arrastra los supuestos de ese ADR.
- **Revisar si:** la fuente empieza a publicar convexidad, o documenta la fórmula de sus
  campos de sensibilidad; o si se quieren shocks mayores al 10%, donde la aproximación
  lineal ya es pobre.
