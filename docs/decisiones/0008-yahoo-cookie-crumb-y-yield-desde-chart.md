---
numero: 0008
titulo: Cookie+crumb para quoteSummary de Yahoo, y derivar el yield del chart
estado: Aceptada
fecha: 2026-08-06
codigo: lib/yahooCrumb.ts, lib/calendario.ts, lib/yahooFundamentals.ts, lib/yahooEarnings.ts
---

# 0008 — Cookie+crumb para `quoteSummary` de Yahoo, y derivar el yield del chart

## Contexto

Yahoo Finance tiene dos familias de endpoints no oficiales pero públicos:

- **`chart`** (`/v8/finance/chart/...`) — precios, series históricas y eventos de
  dividendos. Responde con solo un User-Agent de browser.
- **`quoteSummary`** (`/v10/finance/quoteSummary/...`) — fundamentals: P/E, market cap,
  rango de 52 semanas, dividend yield, earnings. Devuelve **401** con solo el
  User-Agent: exige una cookie de sesión más un token `crumb` asociado a ella.

El dashboard necesita las dos cosas: fundamentals para la tabla de renta variable, y
dividendos para el calendario de cobros y el yield de cada posición.

## Alternativas descartadas

- **Llamar a `quoteSummary` sin cookie ni crumb** — 401. Es el punto de partida del
  problema.
- **Usar `quoteSummary` también para el yield de cada posición** — funciona, pero suma
  una request por ticker a un endpoint que necesita el par cookie+crumb vigente, para un
  dato que ya se puede derivar de una llamada que igual se está haciendo.
- **Una API de mercado con key** (Finnhub, Alpha Vantage y similares) — más estable, pero
  agrega una credencial y límites de plan. Todo el resto del dashboard funciona con
  fuentes sin key.
- **Pedir un crumb nuevo en cada request** — funcionaría, pero son dos llamadas extra por
  cada consulta de fundamentals.

## Decisión

**Para `quoteSummary`:** un módulo compartido (`lib/yahooCrumb.ts`) resuelve el par
cookie+crumb y lo cachea 30 minutos, para no reimplementar el mecanismo en cada
consumidor. El flujo tiene dos pasos poco evidentes:

1. Un `GET` a `https://fc.yahoo.com` que **responde 404 pero igual devuelve las cookies
   `A1`/`A3`** en `Set-Cookie`. El 404 es esperado; lo que importa es el header.
2. Con esa cookie, un `GET` a `/v1/test/getcrumb` para obtener el token.

Si algo falla devuelve `null` en vez de lanzar: los fundamentals son un dato accesorio y
no deben tirar abajo la sección entera.

**Para el yield:** se deriva de la llamada al endpoint `chart` que ya se hace para traer
el histórico de dividendos (`range=5y&interval=3mo&events=div`), sin request adicional ni
necesidad de crumb. El monto estimado de cobro sale de la tenencia y el precio:
`(tenencia_usd / precio) × dividendo_por_acción`, con las retenciones de
[0002](0002-retenciones-excluir-comision-depositario.md) aplicadas.

Todas las llamadas llevan User-Agent de Chrome y `AbortSignal.timeout(8000)`: Yahoo a
veces cuelga la conexión y no hay que arrastrar toda la request.

## Consecuencias y límites

- **Límite — son endpoints no oficiales.** No hay contrato ni versionado: Yahoo puede
  cambiar el mecanismo de crumb o el formato sin aviso. Es el riesgo aceptado a cambio de
  no usar una API con key.
- **Límite — el yield que se muestra es bruto**, mientras el cobro estimado va neto. Es
  deliberado (el yield así se compara con cualquier screener) y está advertido en el
  `SYSTEM_PROMPT` → [0002](0002-retenciones-excluir-comision-depositario.md).
- **Límite — el 404 de `fc.yahoo.com` es parte del flujo normal.** Quien lea los logs no
  debería "arreglarlo".
- **Límite — el cobro estimado asume que la tenencia actual se mantiene** hasta la fecha
  de pago, y usa el precio de hoy para inferir la cantidad de acciones.
- **Revisar si:** `quoteSummary` empieza a devolver 401 de forma consistente (cambió el
  mecanismo de auth); o si los fundamentals aparecen vacíos para todos los tickers a la
  vez (probable cambio de formato).
