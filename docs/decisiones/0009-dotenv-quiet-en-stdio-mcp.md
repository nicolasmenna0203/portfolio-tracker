---
numero: 0009
titulo: Nada puede escribir a stdout en el servidor MCP
estado: Aceptada
fecha: 2026-08-06
codigo: mcp/server.ts
---

# 0009 — Nada puede escribir a stdout en el servidor MCP

## Contexto

El servidor MCP se comunica con el cliente (Claude Desktop, Claude Code) por
**stdio**: los mensajes JSON-RPC del protocolo viajan por stdout. Eso convierte a
stdout en un canal exclusivo del protocolo, no en un lugar donde imprimir.

Cualquier texto que un módulo escriba ahí se mezcla con el flujo JSON-RPC y el cliente
falla al parsearlo. El caso concreto que apareció: `dotenv`, al cargar el `.env`,
imprime un banner (`◇ injected env (N) from .env`) y el cliente muere con
`Unexpected token '◇' ... is not valid JSON`.

El síntoma es desconcertante porque el server "arranca bien" y el error aparece del
lado del cliente, sobre un carácter que no está en ningún archivo del proyecto.

## Alternativas descartadas

- **Leer el `.env` a mano** en vez de usar `dotenv` — evita el banner, pero
  reimplementa el parseo del formato (y el JSON multilínea de la service account es
  justo el caso que lo rompe).
- **Redirigir stdout a nivel de proceso** — el protocolo necesita stdout: silenciarlo
  rompe la comunicación en vez de arreglarla.
- **Transporte HTTP en vez de stdio** — resolvería el problema de raíz, pero obliga a
  levantar y administrar un servidor local para lo que hoy es un proceso que el
  cliente arranca solo.

## Decisión

Tres reglas en `mcp/server.ts`:

1. **`config({ quiet: true })`** al cargar `dotenv`. El `quiet` es obligatorio, no
   cosmético: sin él el banner rompe el cliente.
2. **Todos los logs van a `console.error` (stderr).** Incluye el mensaje de arranque
   y los errores fatales. Claude Desktop los guarda en `%APPDATA%\Claude\logs\`.
3. **El `.env` se carga antes de importar cualquier módulo** que lea `process.env` en
   su raíz, con la ruta resuelta desde `import.meta.url` (el cliente puede arrancar el
   proceso desde otro directorio de trabajo).

Si falta `SPREADSHEET_ID`, el server sale con código 1 y un mensaje a stderr, en vez
de arrancar y fallar en cada tool.

## Consecuencias y límites

- **Límite — la regla aplica a todo el árbol de imports, no solo a `mcp/server.ts`.**
  Cualquier dependencia de `lib/` que agregue un `console.log` rompe el MCP, y el
  error va a aparecer del lado del cliente, lejos de la causa. Es la trampa a
  recordar al agregar logging de debug en `lib/`.
- **Límite — los errores del server no se ven en la conversación**, hay que ir a los
  logs del cliente.
- **Verificación:** `npm run mcp` debe imprimir solo `[cartera-mcp] Server activo por
  stdio.` en stderr y **nada** en stdout.
- **Revisar si:** se migra a transporte HTTP (la restricción de stdout desaparece); o
  si el SDK de MCP cambia de canal.
