---
numero: 0012
titulo: Un solo criterio de tickers elegibles, compartido por todos los consumidores
estado: Aceptada
fecha: 2026-08-06
codigo: lib/tickersElegibles.ts
---

# 0012 — Un solo criterio de tickers elegibles, compartido por todos los consumidores

## Contexto

Varias features necesitan saber, a partir de las tenencias, qué tickers tienen un
símbolo de mercado real consultable en Yahoo: el calendario de cobros, la tabla de renta
variable y el job server-side de la alerta semanal.

El `TIPO` del Sheet no alcanza como criterio, por dos motivos:

- Hay tickers que **sí** cotizan pero quedaron categorizados con un tipo que no pasaría un
  filtro simple (por ejemplo, activos alternativos bajo un tipo propio).
- Hay tickers con tipo aparentemente válido (`ETF`) que en realidad son **fondos comunes
  de inversión** sin símbolo cotizable en Yahoo.

Consultar Yahoo con un ticker inválido no devuelve un error limpio: hace *fuzzy match* y
devuelve resultados de otro instrumento. O sea, datos basura que parecen válidos.

## Alternativas descartadas

- **Filtrar por `TIPO` en cada lugar que lo necesita** — es lo que había implícito, y el
  problema es la deriva: el cliente y el job de alertas terminan con criterios distintos,
  y el mail dice algo diferente de lo que muestra la pantalla. Es un bug silencioso, sin
  excepción visible.
- **Una columna "elegible" en el Sheet** — mueve la lógica a un lugar sin tests ni
  revisión, y hay que mantenerla a mano en cada alta.
- **Intentar la consulta y descartar lo que falle** — Yahoo no falla: hace fuzzy match y
  devuelve otro instrumento.
- **Filtrar por `SECTOR_GEO` solamente** — no distingue un ETF real de un FCI local.

## Decisión

Un módulo único, `lib/tickersElegibles.ts`, con tres conjuntos explícitos y una función
que deriva de las tenencias los insumos que todos comparten:

- **`TIPOS_VALIDOS`** — los tipos que por defecto cotizan (acciones y ETFs).
- **`TICKERS_INCLUIR`** — excepciones: tickers con símbolo real pero tipo que no pasa el
  filtro.
- **`fciEnRentaVariable`** — excepciones inversas: tipo válido en el Sheet, pero sin símbolo
  cotizable (fondos del broker). Es una marca en cada tenencia, tomada de la hoja
  `FondosCAFCI`, porque esos tickers identifican al broker.

`tickersDeCartera()` devuelve de una sola pasada los tickers USA elegibles, los tickers
ARG con cronograma de bonos mapeado, y el valor en USD de cada posición.

Lo consumen tanto la UI como el job de alertas, **precisamente para que el mail no se
desalinee de lo que ve el usuario en pantalla**.

## Consecuencias y límites

- **Límite — las excepciones son listas manuales.** Un activo nuevo con tipo ambiguo no
  se clasifica solo: hay que agregarlo a `TICKERS_INCLUIR` o a la hoja `FondosCAFCI`. El
  síntoma de haberlo olvidado es que el ticker desaparece de las secciones de mercado, o
  que aparece con datos de otro instrumento.
- **Límite — el criterio se basa en cómo está cargado el Sheet** (`TIPO`, `SECTOR_GEO`).
  Un cambio de categoría en el Sheet cambia la elegibilidad sin tocar código.
- **Límite — el fuzzy match de Yahoo sigue siendo el modo de falla** si un ticker
  incorrecto pasa el filtro: no hay error, hay datos de otro activo.
- **Revisar si:** se agrega un consumidor nuevo que necesite un criterio distinto (mejor
  extender este módulo que filtrar aparte); o si aparece una clase de activo que las tres
  listas no cubren bien.
