#!/usr/bin/env node
/**
 * MCP server de la cartera.
 *
 * Expone las herramientas de `lib/agentTools.ts` por stdio para que un cliente
 * MCP (Claude Desktop, Claude Code) pueda consultar la cartera en lenguaje
 * natural. El razonamiento corre en el cliente: este proceso solo lee Google
 * Sheets y devuelve JSON — no llama a ningún modelo ni consume tokens de API.
 *
 * Ejecutar:  npm run mcp
 * Configurar en Claude Desktop: ver README-MCP.md
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Cargar .env antes de importar nada que lea process.env en el módulo raíz.
//
// Decisión y alternativas descartadas: docs/decisiones/0009-dotenv-quiet-en-stdio-mcp.md
//
// `quiet: true` es obligatorio, no cosmético: sin él dotenv escribe su banner
// ("◇ injected env (N) from .env") a stdout, que acá es el canal exclusivo del
// protocolo MCP. El cliente intenta parsear ese texto como JSON-RPC y falla con
// `Unexpected token '◇' ... is not valid JSON`.
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env'), quiet: true });

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { AGENT_TOOLS, ejecutarTool, SYSTEM_PROMPT } from '../lib/agentTools';

const server = new Server(
  { name: 'cartera-finanzas', version: '1.0.0' },
  {
    capabilities: { tools: {} },
    // El cliente muestra esto al usuario y lo antepone al contexto: le da al
    // modelo el mismo encuadre que usa el chatbot del dashboard.
    instructions: SYSTEM_PROMPT,
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: AGENT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const resultado = await ejecutarTool(name, args ?? {});

  return {
    content: [{ type: 'text', text: JSON.stringify(resultado, null, 2) }],
    // `ejecutarTool` nunca lanza: los fallos vuelven como { error }. Marcarlos
    // acá deja que el cliente los distinga de una respuesta con datos.
    isError:
      typeof resultado === 'object' && resultado !== null && 'error' in resultado,
  };
});

async function main() {
  if (!process.env.SPREADSHEET_ID) {
    // stderr, no stdout: stdout es el canal del protocolo MCP.
    console.error('[cartera-mcp] Falta SPREADSHEET_ID. Revisá el .env.');
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[cartera-mcp] Server activo por stdio.');
}

main().catch((err) => {
  console.error('[cartera-mcp] Error fatal:', err);
  process.exit(1);
});
