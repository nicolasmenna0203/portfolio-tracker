---
numero: 0001
titulo: Calcular TIR y duration propias para los bonos provinciales
estado: Aceptada
fecha: 2026-08-06
codigo: lib/bonosProvinciales.ts, lib/bondMetrics.ts, lib/performance.ts
---

# 0001 — Calcular TIR y duration propias para los bonos provinciales

## Contexto

bonistas.com es la fuente de toda la curva de renta fija del dashboard, pero no
trackea deuda provincial ni los Bonos de Consolidación: su dataset (907 registros
al 2026-08-06) solo tiene emisores "Argentina", "BCRA" y ONs corporativas. Sin TIR
ni duration, esos instrumentos quedaban fuera de la curva y de todo el análisis de
renta fija, aunque sí tuvieran precio.

## Alternativas descartadas

- **data912** (ya usada en `lib/precios.ts`) — tiene los tickers con buena
  liquidez, pero solo precio: ni TIR ni duration.
- **IAMC, informe diario de títulos públicos** — el único que publica TIR *y*
  duration de provinciales, pero las tablas del PDF son imágenes escaneadas
  (231 objetos de imagen, streams de texto vacíos). Requeriría OCR: demasiado
  frágil para un número que la UI muestra como preciso.
- **Rava** — solo OHLCV histórico.
- **Docta** y **argen.bond** — publican TIR y paridad server-rendered, pero
  ninguno expone la duration modificada sin login (la vista de curva de
  argen.bond redirige a `/users/sign_in`).

## Decisión

Se arma el flujo de fondos de cada bono a partir de sus condiciones de emisión
(cupón, periodicidad, calendario de amortización) y se calculan TIR y duration
modificada con las fórmulas estándar. El resultado se contrasta contra la TIR que
publican Docta y argen.bond, como control de sanidad (`tirReferencia`, que nunca
se muestra ni se usa como valor).

Dos números **no** son datos oficiales, y eso importa si alguien los va a cambiar:

- **El cupón (`tnaCupon`)** está *calibrado* para que la TIR del flujo coincida con
  la de Docta/argen.bond al 2026-08-06. Las condiciones de emisión completas no
  están publicadas de forma scrapeable, y el cupón corriente de un bono a tasa
  variable cambia en cada período sin fuente pública confiable del valor vigente.
  Las tasas resultantes son económicamente coherentes con cada instrumento (un
  margen razonable sobre TAMAR o Badlar, un cupón real sobre CER), lo que da
  confianza en que el flujo está bien armado.
- **El valor técnico (`valorTecnico`)** es el publicado por Docta a esa misma
  fecha. Es imprescindible en los bonos con capital indexado (CER, y el de
  consolidación): arrastran capital ajustado, así que cotizan muy por encima de
  100 sin estar sobre la par. El flujo se arma en nominales, de modo que
  descontarlo contra el precio sucio da una TIR sin sentido — dio −0,66% y −59%
  en los dos casos con capital indexado. Se descuenta entonces contra la **paridad**
  (precio / valor técnico), que expresa el precio en las mismas unidades que el
  flujo nominal. Verificado: precio/VT reproduce la paridad publicada por Docta.

Los bonos calculados así van marcados con `calculoPropio: true` para que la UI
pueda aclararlo.

Qué bonos se calculan y sus condiciones (cupón, calendario, valor técnico, TIR
de referencia y la fecha de calibración) viven en la hoja `BonosCalculoPropio`
del Sheet, no en el código: la lista dice qué hay en la cartera. Ver
[0030](0030-repo-privado-y-espejo-publico.md).

## Consecuencias y límites

- **Límite — no son comparables con las TIR de bonistas.** No salen del mismo
  cálculo: bonistas asume su propia convención de settlement y proyección de
  tasas. Se suma a la regla de [0004](0004-grupos-de-bono-y-tir-no-comparables.md).
- **Límite — en los de tasa variable** (TAMAR, Badlar) la "TIR" no
  es un dato observable sino una proyección que supone la tasa actual constante
  hasta el vencimiento. Si la tasa se mueve, el rendimiento realizado cambia.
- **Límite — la TIR está anclada a un tercero en una fecha.** Al ser el cupón
  calibrado contra Docta/argen.bond al 2026-08-06, sirve para ubicar los bonos en
  la curva, no como valuación independiente.
- **Límite — el valor técnico es de fecha fija, no live.** Crece con el CER y con
  la tasa devengada, así que la paridad se desactualiza lentamente y la TIR pierde
  precisión con el correr de las semanas. Se prefiere eso a no mostrar el bono.
- **Revisar si:** bonistas suma emisores provinciales a su dataset; aparece una
  fuente que publique duration modificada sin login; o la TIR calculada se separa
  de la de Docta/argen.bond más de ~200 bps (señal de que el cupón calibrado o el
  valor técnico quedaron viejos).
