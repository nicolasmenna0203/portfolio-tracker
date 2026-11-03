---
numero: 0018
titulo: Alinear el ratio por fecha y calcular los indicadores en el cliente
estado: Aceptada
fecha: 2026-08-08
codigo: lib/ratios.ts, lib/ratiosGuardados.ts, app/api/ratio/route.ts, components/RatiosTab.tsx
---

# 0018 — Alinear el ratio por fecha y calcular los indicadores en el cliente

## Contexto

La pestaña de Ratios muestra la serie del cociente entre dos activos y permite
analizarla con medias móviles, bandas de Bollinger y correlación móvil. Las dos
patas del par se bajan con llamadas separadas a Yahoo (`fetchHistoricoTicker`),
y **no tienen por qué traer las mismas fechas**: cada mercado tiene su
calendario de feriados, un activo cripto cotiza los siete días y una acción no,
y un ticker joven tiene menos historia que el otro. Verificado sobre datos
reales: un par cripto/acción a 6 meses devuelve 181 puntos contra 125.

Además, los períodos de las medias móviles son un parámetro de tanteo: se
prueba 20, 50 y 200 en cuestión de segundos para ver cuál describe mejor el
par. Eso define dónde conviene calcular.

## Alternativas descartadas

- **Alinear las dos series por índice (`puntos[i]` contra `puntos[i]`)** — es lo
  directo, y con dos tickers del mismo mercado funciona de casualidad. Con
  calendarios distintos aparea el día de una serie con otro día de la otra y
  desplaza *todo el resto* de la serie a partir de ese punto. El error es
  silencioso: el gráfico se ve perfectamente normal y los números están mal.
- **Rellenar los huecos con el último precio conocido (forward-fill)** —
  conserva más puntos, pero inventa cotizaciones para días en que el activo no
  cotizó. Esos días de precio repetido entran como retorno cero en correlación y
  beta, sesgando ambas hacia abajo por un artefacto de relleno.
- **Calcular los indicadores en el servidor** — dejaría al cliente sin
  aritmética, pero convierte cada ajuste de período en un round-trip. Tantear
  tres ventanas serían tres esperas de red sobre una serie que ya está en
  memoria.
- **Guardar los pares en localStorage** — más simple y sin tocar el Sheet, pero
  repetiría exactamente el problema que resolvió el ADR 0017 con los objetivos:
  solo existen en el navegador que los cargó y el servidor MCP no puede leerlos,
  así que el asesor no sabría qué pares se siguen ni por qué.

## Decisión

**La serie del ratio se alinea indexando por fecha** (`serieRatio` en
`lib/ratios.ts`): se arma un mapa fecha→precio de la pata B y solo sobreviven
las fechas presentes en ambas series. Se descartan además los precios ≤ 0, que
producirían `Infinity` y contaminarían toda métrica aguas abajo. La intersección
es más corta que cualquiera de las dos series, y eso es correcto: son los días
en que ambos activos efectivamente cotizaron.

**El servidor provee la serie; el cliente calcula los indicadores.** La API
`/api/ratio` devuelve los puntos y las estadísticas del período; medias,
bandas y correlación móvil se calculan en `RatiosTab.tsx` sobre la serie ya
descargada.

Dos convenciones de cálculo, elegidas para coincidir con las plataformas de
trading —si el número no coincide con el que ve en otra herramienta sobre el
mismo par, la métrica no sirve para decidir:

- **Bandas de Bollinger con desvío poblacional** (dividir por n, no por n−1).
  Es la formulación original; con n−1 las bandas quedan más anchas y los toques
  de banda no coinciden con los de ninguna otra herramienta.
- **EMA sembrada con la SMA del primer bloque completo**, no con el primer
  valor de la serie. Arrancar en `valores[0]` ancla la EMA temprana a un único
  dato y deja un tramo inicial que no es comparable con el de otra plataforma.

Las medias móviles devuelven `null` mientras no haya ventana completa, en vez
de un promedio parcial: una SMA de 20 promediando 3 valores dibuja una línea
pegada al precio que después converge, un artefacto que se lee como señal.

Correlación y beta devuelven `null` —no 0— cuando no hay varianza. Son
afirmaciones distintas: 0 significa "se mueven de forma independiente", `null`
significa "no se puede afirmar nada".

**Los pares guardados viven en la hoja `Ratios` del Sheet**, con la misma
lógica que el ADR 0017: una fila por par, overwrite completo (la UI manda
siempre la lista entera; un merge dejaría colgados los pares eliminados). Se
expone al asesor por MCP con `ratio_activos`.

## Consecuencias y límites

- **Límite:** la serie del ratio es tan larga como la intersección de ambos
  calendarios. Un par entre un activo que cotiza los siete días y una acción
  pierde los fines de semana; un par con un ticker de historia corta queda
  acotado al más joven, aunque se pida rango de 5 años.
- **Límite:** los precios son los que devuelve Yahoo, ajustados por splits pero
  **no por dividendos**. En un par donde una pata rinde mucho más por dividendo
  que la otra, el ratio subestima su fuerza relativa real: la caída del precio
  el día ex-dividendo entra en la serie, el cobro no.
- **Límite:** el z-score y el percentil describen la posición del ratio dentro
  del período elegido, no predicen reversión. Un par puede quedarse en un
  extremo estadístico durante meses, y en una tendencia sostenida el extremo
  *es* la tendencia. Cambiar el rango cambia la lectura: el mismo par puede dar
  percentil 90 a un año y 30 a cinco.
- **Límite:** al calcular en el cliente, los indicadores dependen de la serie
  descargada. En rango de 5 años el intervalo es semanal (lo hereda de
  `fetchHistoricoTicker`), así que una "media de 20" ahí son 20 semanas, no 20
  días. El número de período no significa lo mismo en todos los rangos.
- **Revisar si:** aparece la necesidad de comparar un par contra un tercer
  activo, o de ver el ratio de un bono ARG. Hoy el universo son tickers
  cotizables en Yahoo (acciones y ETF, ver ADR 0012); los bonos no pasan por
  esta pantalla.
