---
numero: 0020
titulo: Elegir la fuente de precio por naturaleza del instrumento, sin tocar la clasificación del usuario
estado: Aceptada
fecha: 2026-10-24
codigo: lib/tickersElegibles.ts, lib/performanceVariable.ts, lib/fciCocos.ts, components/RentaVariableSection.tsx
---

# 0020 — Elegir la fuente de precio por naturaleza del instrumento, sin tocar la clasificación del usuario

## Contexto

La pestaña de Renta Variable mostraba un "Valor en cartera" menor que el total de
renta variable del Resumen y del Informe. La diferencia cuadraba al centavo con
dos posiciones que no aparecían en la tabla, por dos causas distintas:

1. **Una acción con clase.** El ticker del Sheet se escribe sin separador y el
   proveedor de precios usa guión (patrón `XXXX` → `XXX-X`). El chart devolvía
   404, y como el código descarta sin precio (`if (px == null) continue`), la
   posición desaparecía de la tabla en silencio. El 404 sí se veía, pero en otro
   lado: el calendario de cobros lo reportaba como error de dividendos. Existía ya
   un `aliasYahoo()` con el mapeo correcto, pero estaba aplicado en un solo call
   site (el gráfico histórico) y no en precios, fundamentals ni dividendos.

2. **Un fondo clasificado como renta variable.** El Sheet lo tiene con `TIPO=ETF`
   porque, desde el punto de vista de la asignación de activos, es exposición a
   acciones. Pero es un FCI: no cotiza en el proveedor de precios. Ya estaba en
   `TICKERS_EXCLUIR` ([0012](0012-criterio-unico-de-tickers-elegibles.md)) para que
   no se le pidieran datos a Yahoo, y la pestaña de FCI lista solo los de
   `TIPO=FCI`. Resultado: caía entre las dos fuentes y su valor no sumaba en
   ninguna pestaña. Es exactamente el modo de falla que 0012 anticipó ("el síntoma
   de haberlo olvidado es que el ticker desaparece de las secciones de mercado").

## Alternativas descartadas

- **Reclasificar el fondo en el Sheet como `TIPO=FCI`** — la clasificación es del
  usuario y expresa su criterio de asignación (exposición a renta variable).
  Cambiarla para acomodar de dónde sale el precio invierte la relación: mueve el
  dato del usuario para que encaje en la implementación, y además movería el activo
  de lugar en el Resumen, el Informe y los objetivos de composición.
- **Agregar el fondo a la pestaña de FCI** — mostraría el valor en algún lado, pero
  rompe el conteo de esa pestaña ("N de N fondos") y sigue dejando el total de
  Renta Variable corto, que era el síntoma original.
- **Mostrar la fila sin precio ni variaciones, solo con la tenencia** — cierra el
  total pero deja una fila muda, cuando la planilla de CAFCI sí tiene VCP y
  rendimientos para ese fondo.
- **Normalizar el ticker con una regla general** (insertar guión antes de la última
  letra) — rompe tickers legítimos de 4 letras. El universo de acciones con clase
  es chico y conocido: una lista explícita es más segura que una heurística.
- **Resolver el alias dentro de cada módulo que llama al proveedor** — es la deriva
  que 0012 vino a evitar; el mapeo tiene que vivir en un solo lugar.

## Decisión

Dos cambios, uno por causa.

**Alias de símbolo aplicado en todos los call sites.** `aliasYahoo()` se usa ahora
en precios/dividendos del chart, en `quoteSummary` (fundamentals y earnings), en la
serie de la variación semanal y en el histórico. El mapeo sigue viviendo en
`lib/tickersElegibles.ts`, con el ticker de cartera como clave. **Lo que se traduce
es la consulta al proveedor, no la identidad del activo:** los resultados se siguen
indexando y mostrando con el ticker de cartera, que es el que el usuario reconoce.
Queda afuera a propósito el endpoint de noticias, que es una búsqueda por texto
con fuzzy match, no un lookup por símbolo.

**La fuente de precio se elige por naturaleza del instrumento.** Se agrega
`TICKERS_FCI_EN_RENTA_VARIABLE`: tickers que la cartera clasifica como renta
variable y que son fondos CAFCI. `tickersDeCartera()` los devuelve en
`tickersFciVariable`, separado de `tickersUsa` (que va al proveedor de precios), y
`fetchPerformanceVariable()` los resuelve contra la planilla, inyectándolos en la
misma lista con `esFci: true`. El `TIPO` del Sheet no se toca: sigue mandando en el
Resumen, el Informe y los objetivos.

Para que la fila comparta las columnas de la tabla, el VCP ocupa la columna de
precio y los rendimientos de mes / año / 12 meses ocupan las de variación 1M / YTD
/ 1A. La fila lleva un chip **FCI** y la moneda del VCP explícita.

En CAFCI el mapeo va en un diccionario aparte del de los fondos tipo FCI, para que
la pestaña de FCI siga contando solo los que el usuario considera FCI. Las dos
listas se resuelven en la misma pasada del archivo: es la misma descarga de ~1 MB.

## Consecuencias y límites

- **Límite — el VCP no es un precio en USD.** Puede estar en pesos, y en esa fila
  la columna "Precio" cambia de unidad respecto de las demás. Se mitiga con el
  prefijo de moneda, el chip FCI y una nota al pie, pero **ordenar la tabla por
  precio mezcla unidades**. La tool del MCP lleva la advertencia equivalente para
  que el modelo no compare un VCP en ARS contra un precio en USD.
- **Límite — las variaciones de esas filas no son variaciones de precio de
  mercado**, son rendimientos publicados sobre ventanas de calendario (cierre de
  mes, cierre de año). No son estrictamente homogéneas con la variación 1M/YTD de
  una acción, que se calcula sobre closes diarios.
- **Límite — el fondo no tiene serie de precios en el proveedor**, así que no tiene
  gráfico histórico: su fila no es seleccionable y no puede quedar preseleccionada
  (si no, el gráfico arrancaría vacío).
- **Límite — las dos listas siguen siendo manuales**, como en 0012. Un fondo nuevo
  cargado como ETF vuelve a caer entre las fuentes hasta que se lo agregue, y una
  acción con clase nueva vuelve a dar 404. El síntoma a vigilar es el mismo: el
  total de la pestaña deja de cuadrar con el del Resumen.
- **Límite — si la planilla falla, esas filas no aparecen** (se capturan aparte
  para no arrastrar a las acciones, que sí tienen su propia fuente), y el total de
  la pestaña vuelve a quedar corto en ese importe.
- **Revisar si:** aparece un fondo así en otra pestaña que también pida precios, o
  si el proveedor empieza a cotizar los fondos locales (ahí el caso 2 desaparece).
