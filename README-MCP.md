# MCP server de la cartera

Expone los datos de la cartera como herramientas para Claude Desktop y Claude Code,
para poder preguntar en lenguaje natural sobre tenencias, evolución y concentración.

**No consume tokens de API.** El razonamiento lo hace el Claude que ya estás pagando
con tu suscripción; este proceso solo lee el Google Sheet y devuelve JSON.

## Herramientas

### Cartera (leen el Google Sheet)

| Herramienta | Devuelve |
|---|---|
| `resumen_cartera` | KPIs: total USD/ARS, aportes, rendimiento, TIR, cantidad de activos |
| `listar_tenencias` | Todas las posiciones de un mes con peso y atributos |
| `distribucion` | Agrupado por tipo, riesgo, geografía, renta o moneda |
| `evolucion_mensual` | Serie mensual + mejor y peor mes (acepta rango) |
| `historico_ticker` | Evolución de una posición puntual mes a mes |
| `metricas_concentracion` | Top 1/3/5, índice HHI y posiciones ordenadas por peso |
| `listar_movimientos` | Aportes y retiros cargados, con fecha, monto USD/ARS y totales del período |

Los meses se piden en formato `YYYY-MM` (ej. `2026-07`). Si se omite, se usa el último disponible.

### Mercado (consultan fuentes externas)

| Herramienta | Devuelve | Fuente |
|---|---|---|
| `calendario_cobros` | Dividendos, cupones y amortizaciones próximas con monto neto estimado, más el yield de cada posición | Yahoo, Nasdaq, bonistas.com |
| `renta_fija_bonos` | TIR, TNA, duration, paridad y vencimiento de los bonos en cartera, con ponderados por grupo de tasa | bonistas.com |
| `renta_fija_fci` | VCP y rendimientos (día/mes/año/12m) de los FCI del broker. Un rendimiento en `null` es "no informado", no 0% | Planilla CAFCI |
| `renta_variable_acciones` | Precio, variaciones, P/E, market cap, 52 semanas y dividend yield. Las filas con `es_fci` traen VCP en `moneda_vcp` y rendimientos de CAFCI en vez de precio de mercado | Yahoo Finance + Planilla CAFCI |
| `comparar_benchmarks` | Cartera vs. S&P 500, inflación, MEP, Bitcoin y oro (índice base 100) | Varias |
| `ratio_activos` | Fuerza relativa entre dos activos: ratio A/B, percentil, z-score, correlación y beta. Sin argumentos lista los pares guardados | Yahoo Finance |

Los tickers **no se pasan como parámetro**: se derivan de la cartera con el mismo criterio
que usa el dashboard ([tickersElegibles.ts](lib/tickersElegibles.ts)). La excepción es
`ratio_activos`, donde el par se pide explícitamente porque el sentido de la herramienta
es comparar contra cualquier referencia, esté o no en la cartera.

### Criterio y memoria

| Herramienta | Devuelve |
|---|---|
| `objetivos_composicion` | Composición real vs. objetivos fijados, con desvío en pp y ajuste en USD |
| `perfil_inversor` | Objetivo, criterios de venta, tolerancia y decisiones ya tomadas |
| `registrar_aprendizaje` | Agrega una decisión al log del perfil (escritura) |

Estas herramientas tardan entre 0,6 y 3 segundos la primera vez. Después salen del cache
(15 minutos), así que un análisis largo no vuelve a esperar.

## Sutilezas que el modelo conoce

Las descripciones de las herramientas y el system prompt le advierten al modelo sobre
cuatro cosas que, si se ignoran, producen respuestas equivocadas:

1. **Los dividendos van netos** (30% de retención de origen + 0,6% de impuesto al cheque =
   factor 0,694). No descuentan la comisión del depositario, así que el neto real puede ser
   1-2% menor. Los bonos ARG van al 100%.
2. **El yield publicado es bruto, el cobro estimado es neto.** Son inconsistentes a
   propósito: el yield así se compara con cualquier screener.
3. **Las TIR de bonos solo se comparan dentro del mismo grupo** (USD, CER, ARS_TASA,
   DOLLAR_LINKED, BOPREAL, ONS_USD). Cruzar grupos no significa nada — ni siquiera USD
   contra ONS_USD, aunque ambos sean hard-dollar: distinto riesgo de crédito.
4. **En `comparar_benchmarks`, la serie de la cartera incluye aportes nuevos.** No es
   rendimiento puro: la cartera "creció" mucho más que cualquier benchmark simplemente
   porque le fuiste agregando plata. Para rendimiento real, `resumen_cartera`.

## Probarlo localmente

```bash
npm run mcp
```

Debería imprimir `[cartera-mcp] Server activo por stdio.` y quedarse esperando.
Se corta con Ctrl+C. Por sí solo no hace nada: necesita un cliente MCP conectado.

## Conectarlo a Claude Desktop

El bloque va en `%APPDATA%\Claude\claude_desktop_config.json`, conservando las
preferencias que ya tenga el archivo. Después hay que **reiniciar Claude Desktop por
completo** (cerrarlo desde la bandeja del sistema, no solo la ventana) para que las 11
herramientas de `cartera` aparezcan en el ícono de herramientas del cuadro de texto.

Reemplazá `<RUTA-AL-PROYECTO>` por la ruta absoluta donde clonaste el repo:

```json
{
  "mcpServers": {
    "cartera": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": [
        "<RUTA-AL-PROYECTO>\\node_modules\\tsx\\dist\\cli.mjs",
        "<RUTA-AL-PROYECTO>\\mcp\\server.ts"
      ]
    }
  }
}
```

Dos decisiones a tener en cuenta si algún día lo tocás:

- **Se invoca `node.exe` con la ruta absoluta al cli de `tsx`**, en vez de `npx tsx`. Claude
  Desktop no hereda el PATH del shell, así que `npx` puede no resolver y el server no arranca.
- **Las barras invertidas van dobladas**: es JSON, `\` es carácter de escape.

> Conviene respaldar el archivo antes de editarlo, por ejemplo como
> `claude_desktop_config.backup-AAAAMMDD-HHMMSS.json` en la misma carpeta.

## Proyecto de Claude Desktop

Para no re-explicar el contexto en cada conversación, conviene crear un Proyecto con
instrucciones propias (preferencias de formato, perfil del inversor, cómo se quieren las
respuestas). Esas instrucciones son personales, así que **se mantienen fuera del repo**:
este repositorio es público.

Las herramientas del MCP funcionan igual dentro o fuera de un Proyecto — se configuran
a nivel aplicación. El Proyecto solo agrega las instrucciones.

## Conectarlo a Claude Code

Desde la raíz del proyecto:

```bash
claude mcp add cartera -- npx tsx ./mcp/server.ts
```

## Ejemplos de preguntas

**Cartera**
- ¿Cómo viene la cartera este mes?
- ¿Cuáles son mis cinco posiciones más grandes y cuánto pesan juntas?
- ¿Estoy muy concentrado? ¿Qué debería mirar?
- ¿Cómo evolucionó SPY desde que lo compré?
- ¿Qué mes fue el peor y qué pasó con la cartera ese mes?

**Mercado**
- ¿Cuánto voy a cobrar de renta en los próximos seis meses?
- ¿Qué bonos tengo con más duration y qué riesgo implica?
- ¿Cómo vienen mis acciones este año? ¿Alguna cerca de su máximo de 52 semanas?
- ¿Le estoy ganando a la inflación?
- Entre mis FCI y mis bonos CER, ¿qué rindió mejor?

**Cruzadas** (varias herramientas en una respuesta)
- Mirá mi concentración y mis próximos cobros: ¿tiene sentido reinvertir la renta en algo distinto?
- Compará el rendimiento de mi renta fija contra lo que hubiera dado quedarme en MEP.

## Credenciales

El server lee `.env` de la raíz del proyecto. Necesita `SPREADSHEET_ID` y
`GOOGLE_SERVICE_ACCOUNT_JSON`, las mismas que usa el dashboard. Si falta
`SPREADSHEET_ID`, sale con un error explícito en vez de arrancar roto.

## Si algo falla

El server escribe sus logs a **stderr** (stdout es el canal del protocolo MCP).
Claude Desktop los guarda en `%APPDATA%\Claude\logs\`.

| Síntoma | Causa habitual |
|---|---|
| Las herramientas no aparecen | Claude Desktop no se reinició del todo, o el path del JSON está mal |
| `Falta SPREADSHEET_ID` | El `.env` no está en la raíz del proyecto |
| Error de Google al llamar una herramienta | `GOOGLE_SERVICE_ACCOUNT_JSON` vencido o sin permiso sobre el Sheet |

## Nota sobre los datos

Las herramientas cachean la lectura del Sheet 60 segundos, porque una sola pregunta
suele disparar varias llamadas. Si acabás de subir un archivo al dashboard y querés
verlo reflejado, esperá un minuto o reiniciá el server.
