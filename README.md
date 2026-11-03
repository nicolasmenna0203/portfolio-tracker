# Portfolio Tracker

Dashboard de seguimiento de una cartera de inversiones (CEDEARs, ETFs, bonos argentinos y FCI), conectado a Google Sheets como fuente de verdad. Incluye un servidor MCP que expone la cartera a Claude para análisis conversacional.

**Demo pública sin datos reales:** [portfolio-tracker-demo-lake.vercel.app/demo](https://portfolio-tracker-demo-lake.vercel.app/demo) — mismo dashboard, con datos 100% sintéticos, sin login.

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Recharts** — gráficos interactivos
- **Google Sheets API v4** — fuente de datos vía Service Account
- **unpdf** — extracción de texto de PDFs en entornos serverless
- **Tailwind CSS 4** — estilos base
- **Vitest** — tests unitarios
- **@modelcontextprotocol/sdk** — servidor MCP

## Funcionalidades

Seis tabs, todas dentro de una sola página:

| Tab | Qué muestra |
|---|---|
| **Resumen** | KPIs (total, aportes, rendimiento neto, TIR anual), evolución mensual |
| **Tenencias** | Composición (treemap con filtro por tipo y evolución), variación y objetivos del mes seleccionado, con selector común de mes y dimensión |
| **Benchmarks** | Cartera vs S&P 500, inflación, MEP, BTC y oro, en base 100 |
| **Calendario** | Cobros esperados: dividendos, renta y amortización de bonos, balances |
| **Performance** | Renta fija (TIR, duration, paridad, sensibilidad), renta variable (fundamentals), carry trade, FCI y ratios |
| **Finanzas Personales** | Ingresos (haberes cargados y su evolución), gastos mensuales (recurrentes y estimados) por categoría, con vigencia, total mensual/anual y peso sobre el ingreso, y proyección de la cartera a futuro |

Transversal: tema claro/oscuro, toggle USD/ARS, botón para ocultar valores.

Además: carga de tenencias, movimientos y haberes desde PDF; alerta semanal de cobros por mail.

## Demo pública

**[portfolio-tracker-demo-lake.vercel.app/demo](https://portfolio-tracker-demo-lake.vercel.app/demo)**

La ruta `/demo` (y sus `/api/demo/*` correspondientes) sirve el mismo `<Dashboard>` con datos 100% sintéticos generados en `lib/demo/` — nunca lee Google Sheets ni pega a Yahoo/bonistas/CAFCI, así que no requiere login ni expone la cartera real. Los montos se muestran siempre ocultos. Corre como un segundo proyecto de Vercel (`portfolio-tracker-demo`), deployado desde esta misma rama, con su propia URL desvinculada del dominio real.

## Arquitectura

Por capas, para que no se desactualice con cada archivo nuevo:

```
app/
  page.tsx           Server Component: fetchDashboardData() → <Dashboard>
  login/             login (el resto del sitio está detrás de middleware)
  api/               route handlers: upload-*, estado-cargas, performance*, fci,
                     calendario-financiero, benchmarks, fx,
                     ingresos, objetivos, ratio, ratios-guardados,
                     alertas/semanal, auth/*
components/          componentes cliente; Dashboard.tsx orquesta los tabs
lib/                 lógica de negocio y acceso a datos (+ tests .test.ts)
  sheets.ts          fetchDashboardData(): las hojas → modelo del dashboard
  precios.ts         precios spot y MEP
  bondMetrics.ts     TIR/duration/paridad de bonos
  agentTools.ts      las 16 tools del MCP + SYSTEM_PROMPT
  use*.ts            hooks de datos del cliente
mcp/server.ts        servidor MCP por stdio (delega en lib/agentTools.ts)
middleware.ts        auth por cookie de sesión firmada (Edge runtime)
scripts/             utilidades puntuales (backfill de ARS)
types/index.ts       tipos compartidos
```

**Por qué el código es así:** las decisiones no obvias (cálculos propios de TIR, tratamiento del MEP, límites de cada fuente de datos) están documentadas en **[docs/decisiones/](docs/decisiones/README.md)**. Antes de cambiar una constante financiera o una fuente, buscá el archivo en la columna "Código" de ese índice.

El servidor MCP tiene su propia doc: **[README-MCP.md](README-MCP.md)**.

## Setup local

### 1. Clonar e instalar

```bash
git clone https://github.com/<usuario>/portfolio-tracker.git
cd portfolio-tracker
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env
```

| Variable | Descripción |
|---|---|
| `SPREADSHEET_ID` | ID del Google Sheet (está en la URL de Sheets) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON completo de la Service Account, en una línea |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | credenciales de login |
| `SESSION_SECRET` | string aleatorio para firmar la cookie de sesión |
| `CRON_SECRET` | secreto del cron que dispara la alerta semanal |
| `RESEND_API_KEY` | envío del mail de alerta |
| `ALERTA_EMAIL` | destinatario del mail de alerta |

### 3. Compartir el Sheet con la Service Account

En Google Sheets → Compartir → pegar el `client_email` del JSON → rol **Editor** (necesario para cargar tenencias).

### 4. Correr

```bash
npm run dev     # dashboard en http://localhost:3000
npm test        # tests (vitest)
npm run mcp     # servidor MCP por stdio
npm run build   # build de producción
```

## Deploy en Vercel

1. Conectar el repositorio en [vercel.com](https://vercel.com)
2. Agregar todas las variables de la tabla anterior en **Settings → Environment Variables**

La alerta semanal se dispara desde GitHub Actions (`.github/workflows/alerta-semanal.yml`), no desde Vercel Cron — requiere el secret `CRON_SECRET` y la variable `DASHBOARD_URL` en el repo de GitHub. El motivo de esa elección está en [docs/decisiones/](docs/decisiones/README.md).

## Estructura del Google Sheet

| Hoja | Columnas | Descripción |
|---|---|---|
| `Activos` | TICKER, BROKER, TIPO, RIESGO, SECTOR GEO, RENTA, MONEDA | Catálogo de instrumentos |
| `Movimientos` | Fecha, Monto (USD), Monto (ARS), Ingreso/Salida | Flujos de caja — `ingreso` suma al acumulado, `salida` resta. `Monto (ARS)` es el monto al MEP del día exacto del movimiento: sin esa columna los importes en pesos quedan en cero |
| `Tenencias` | Ticker, Tenencia (ARS), Tenencia (USD), Fecha | Snapshots mensuales de posiciones |
| `Ingresos` | Fecha, Empleador, Monto (ARS), Monto (USD) | Haberes acreditados |
| `FondosCAFCI` | TICKER, NOMBRE_CAFCI, RENTA_VARIABLE, CATEGORIA_HISTORICO | Fondos del broker que se buscan en la planilla de CAFCI, por nombre exacto. `RENTA_VARIABLE` (`SI`/`NO`) marca los que el Sheet clasifica como renta variable y no se le piden a Yahoo. `CATEGORIA_HISTORICO` es opcional. Están acá y no en el código porque identifican al broker. Se edita a mano |
| `Objetivos` | Un bloque de 2 columnas por dimensión | Composición objetivo. La crea y reescribe el dashboard: no editar a mano |
| `BonosCalculoPropio` | TICKER, NOMBRE, GRUPO, ETIQUETA, MONEDA, VENCIMIENTO, SIMBOLO_PRECIO, TNA_CUPON, PAGOS_POR_ANIO, PRIMER_CUPON, AMORTIZACIONES, VALOR_TECNICO, TIR_REFERENCIA, NOTA | Bonos que bonistas no cubre (provinciales, de consolidación) y a los que el dashboard les calcula TIR y duration propias (ADR 0001). Números con punto decimal; `AMORTIZACIONES` como `YYYY-MM-DD:porcentaje` separadas por `;`. Una fila inválida se omite con un aviso. Se edita a mano |
| `TickersEspeciales` | TICKER, REGLA, NOTA | `COTIZA`: tiene símbolo en Yahoo aunque su TIPO no pase el filtro (ej. un ETF cargado como ALTS). `EXCLUIR_BONO`: no se muestra en la curva de renta fija. Se edita a mano |
| `GastosFijos` | Nombre, Monto, Moneda, Frecuencia, Categoria, Desde, Hasta | Gastos mensuales (recurrentes y estimados). Catálogo con vigencia: `Desde` / `Hasta` son el primer y último mes que cuenta (`YYYY-MM`, opcionales; `Desde` vacío = cuenta desde siempre). `Categoria` es una de: Súper y comida, Transporte, Hogar, Ocio y personal; otro valor se muestra igual y la tab sugiere a cuál moverlo. Se edita desde la tab o a mano; el dashboard reescribe toda la hoja en cada guardado. Las filas existentes sin las dos columnas nuevas siguen funcionando |

### Cálculo de métricas

Todo se deriva en código a partir de las hojas, sin hoja Resumen:

- **Total cartera**: suma de `Tenencia (USD)` de todos los activos del mes
- **Aportes acumulados**: suma acumulada del neto de movimientos hasta ese mes
- **Rendimiento neto**: `total_cartera − aportes_acumulados`
- **TIR anual**: XIRR con Newton-Raphson — movimientos como flujos de caja, valor actual de la cartera como flujo terminal

Las valuaciones en ARS usan el dólar MEP **de cada mes**, no un MEP único; los aportes usan el MEP del día exacto del movimiento.

## Carga de datos

En la tab de carga, arrastrar el PDF mensual del broker. El sistema:

1. Extrae el texto del PDF localmente (sin APIs externas)
2. Detecta el mes y el tipo de cambio MEP
3. Parsea los instrumentos de la última sección de cierre
4. Sube las filas a `Tenencias` con fecha = último día del mes
5. Previene cargar un mes ya existente

El mismo flujo aplica a movimientos y a recibos de haberes, con sus parsers propios (`lib/parser.ts`, `lib/haberes.ts`).
