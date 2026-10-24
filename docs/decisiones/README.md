# Decisiones técnicas

Por qué el código es así. Cada archivo documenta una decisión tomada, con las
alternativas que se evaluaron y descartaron, y los límites que arrastra.

Antes de cambiar una constante financiera, una fórmula o una fuente de datos:
buscá el archivo en la columna **Código** y leé el ADR. Varias cosas que parecen
imprecisas o raras son deliberadas, y el motivo no siempre es evidente desde el
código.

Los ADRs **no se editan** cuando cambia la decisión: se escribe uno nuevo y el
viejo pasa a "Reemplazadas". Ver [PLANTILLA.md](PLANTILLA.md) para el flujo completo.

**Próximo número: 0021**

## Renta fija

| # | Decisión | Código |
|---|---|---|
| [0001](0001-tir-duration-propias-bonos-provinciales.md) | TIR y duration propias para los bonos provinciales | `lib/bonosProvinciales.ts` |
| [0004](0004-grupos-de-bono-y-tir-no-comparables.md) | Grupos de bono: las TIR de distinto grupo no son comparables | `lib/bondMetrics.ts` |
| [0005](0005-parsear-cafci-con-zlib-nativo.md) | Parsear la planilla CAFCI con `zlib` nativo, sin librería de xlsx | `lib/fciCocos.ts` |
| [0019](0019-sin-dato-no-es-cero-en-rendimientos-de-fci.md) | Un rendimiento que la fuente no publica es `null`, no 0 | `lib/fciCocos.ts`, `components/FciSection.tsx` |
| [0006](0006-sensibilidad-sin-convexidad.md) | Estimar sensibilidad de precio con duration, ignorando convexidad | `lib/performance.ts` |

## Impuestos y moneda

| # | Decisión | Código |
|---|---|---|
| [0002](0002-retenciones-excluir-comision-depositario.md) | Excluir la comisión del depositario del neto de dividendos | `lib/retenciones.ts` |
| [0003](0003-variacion-semanal-por-moneda-nativa.md) | Calcular la variación semanal sobre la moneda nativa de cada activo | `lib/variacionSemanal.ts` |
| [0007](0007-mep-mensual-no-mep-unico.md) | Usar el MEP de cada mes, no un MEP único | `lib/precios.ts`, `lib/sheets.ts` |

## Métricas

| # | Decisión | Código |
|---|---|---|
| [0011](0011-xirr-newton-raphson-multi-semilla.md) | XIRR con Newton-Raphson y varias semillas | `lib/finance.ts` |
| [0012](0012-criterio-unico-de-tickers-elegibles.md) | Un solo criterio de tickers elegibles para todos los consumidores | `lib/tickersElegibles.ts` |
| [0020](0020-fuente-de-precio-por-naturaleza-del-instrumento.md) | La fuente de precio se elige por naturaleza del instrumento, sin tocar la clasificación del usuario | `lib/tickersElegibles.ts`, `lib/performanceVariable.ts` |
| [0013](0013-benchmarks-incluyen-aportes.md) | La serie de la cartera en benchmarks incluye aportes | `lib/benchmarks.ts` |
| [0018](0018-ratios-alineados-por-fecha-e-indicadores-en-el-cliente.md) | Alinear el ratio por fecha y calcular los indicadores en el cliente | `lib/ratios.ts`, `components/RatiosTab.tsx` |

## Asistente

| # | Decisión | Código |
|---|---|---|
| [0016](0016-perfil-inversor-como-memoria-del-asesor.md) | Memoria del asesor en un archivo de perfil local, con escritura acotada | `lib/perfilInversor.ts` |
| [0017](0017-objetivos-de-composicion-en-el-sheet.md) | Objetivos de composición en el Sheet, no en localStorage | `lib/objetivos.ts` |

## Fuentes externas

| # | Decisión | Código |
|---|---|---|
| [0008](0008-yahoo-cookie-crumb-y-yield-desde-chart.md) | Cookie+crumb para Yahoo; el yield se deriva del chart | `lib/yahooCrumb.ts`, `lib/calendario.ts` |

## Infraestructura

| # | Decisión | Código |
|---|---|---|
| [0009](0009-dotenv-quiet-en-stdio-mcp.md) | `dotenv` en modo silencioso: stdout es del protocolo MCP | `mcp/server.ts` |
| [0010](0010-webpack-cache-en-memoria-por-onedrive.md) | Cache de webpack en memoria en dev, por OneDrive | `next.config.ts` |
| [0014](0014-hmac-webcrypto-por-edge-runtime.md) | Firmar la sesión con WebCrypto, no con `node:crypto` | `lib/session.ts` |
| [0015](0015-cron-semanal-en-github-actions.md) | Disparar la alerta semanal desde GitHub Actions, no Vercel Cron | `.github/workflows/alerta-semanal.yml` |

## Reemplazadas

_Ninguna todavía._
