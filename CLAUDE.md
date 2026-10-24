# Portfolio Tracker

Dashboard de seguimiento de una cartera (CEDEARs, ETFs, bonos argentinos, FCI) en
Next.js 15 (App Router) + React 19 + TypeScript. Google Sheets es la fuente de
verdad. Deploy en Vercel. Un servidor MCP (`mcp/server.ts`) expone 16 tools de
`lib/agentTools.ts` para consultar la cartera desde Claude. La alerta semanal de
cobros la dispara GitHub Actions.

## El repo es público

No escribas en ningún archivo versionado:

- Tickers de posiciones reales, montos, cantidades, pesos de cartera.
- Nombre del broker, del banco o de empleadores. Se dicen por rol: "el broker",
  "el banco", "el depositario local".
- Datos identificatorios: nombres de personas, CUIL/CUIT reales, mails, sueldos,
  rutas absolutas con el nombre de usuario.
- Perfil personal: horizonte de inversión, aportes, tolerancia al riesgo.

Sí va, porque es ingeniería: fuentes de datos públicas y sus limitaciones
técnicas, fórmulas, convenciones de cálculo, constantes impositivas de régimen
general, y clases de instrumento o grupos de tasa (sin decir cuáles se tienen).

Los fixtures de test son **sintéticos**: mismo formato que los archivos reales,
con datos ficticios (ver `lib/haberes.test.ts`). Si necesitás un fixture nuevo a
partir de un documento real, anonimizalo antes.

## Antes de tocar lógica financiera

**Las decisiones técnicas están en [docs/decisiones/](docs/decisiones/README.md).**
Antes de cambiar una constante, una fórmula o una fuente de datos, buscá el
archivo en la columna "Código" del índice. Casi todo lo que parece raro es
deliberado y tiene alternativas ya descartadas.

Tres reglas que se violan seguido:

1. **No inventes ni "corrijas" constantes financieras.** Números como
   `FACTOR_NETO_DIVIDENDO = 0.694` o los cupones de `bonosProvinciales.ts` tienen
   origen documentado — algunos son calibrados contra terceros, no datos
   oficiales. Si parece impreciso, leé el ADR: la imprecisión suele ser la
   decisión. → 0001, 0002
2. **Las TIR solo se comparan dentro del mismo grupo de tasa** (USD, CER,
   ARS_TASA, DOLLAR_LINKED, BOPREAL, ONS_USD). Cruzar grupos no significa nada,
   ni siquiera USD contra ONS_USD (mismo hard-dollar, distinto riesgo de
   crédito). → 0004
3. **Cada mes usa el MEP de ese mes**, no un MEP único; los aportes usan el MEP
   del día exacto del movimiento. → 0007

Cuando tomemos una decisión con alternativas descartadas, ofrecé escribir el ADR
antes de cerrar el tema — es el momento con la mejor información.

## Comandos

| | |
|---|---|
| `npm run dev` | dashboard en :3000 |
| `npm test` | vitest (suites en `lib/*.test.ts`) |
| `npm run mcp` | servidor MCP por stdio |
| `npm run build` | build de producción |

## Convenciones

- **Todo en español**: comentarios, commits, UI, nombres de ADRs.
- **Commits**: `feat:` / `fix:` / `refactor:` / `chore:` + descripción en
  minúscula.
- Los headers de módulo que explican el "por qué" son deliberados y valiosos:
  **mantenelos actualizados al cambiar el archivo**. Si el header contradice al
  código, el header es el bug.
- Las tools del MCP devuelven **datos crudos**, no strings formateados: el modelo
  redacta, el código provee los hechos.
- Las reglas que el modelo necesita en runtime van en `SYSTEM_PROMPT` de
  `lib/agentTools.ts`, no duplicadas en otro lado.

## Gotchas del entorno

- El repo vive en **OneDrive**: el cache de webpack en disco falla, en dev va en
  memoria. No "arregles" `next.config.ts`. → 0010
- El MCP habla JSON-RPC por **stdout**: nada más puede escribir ahí. `dotenv` va
  con `{quiet:true}` y los logs a stderr. → 0009
- `middleware.ts` corre en **Edge**: no hay `node:crypto`, se usa WebCrypto. → 0014

## Documentación

| Archivo | Para qué |
|---|---|
| [docs/decisiones/](docs/decisiones/README.md) | por qué el código es así |
| [README.md](README.md) | setup, arquitectura, estructura del Sheet |
| [README-MCP.md](README-MCP.md) | qué hace cada tool del MCP y cómo conectarlo |
