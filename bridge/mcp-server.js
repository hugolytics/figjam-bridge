// bridge/mcp-server.js
// Spawned by Claude Code as a stdio MCP server.
// Forwards all tool calls to the running bridge HTTP API on localhost:3101.
// Does NOT bind any ports itself.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BRIDGE_URL = process.env.BRIDGE_URL ?? 'http://localhost:3101';

async function call(path, args = null) {
  const res = await fetch(`${BRIDGE_URL}${path}`, {
    method: args ? 'POST' : 'GET',
    headers: args ? { 'Content-Type': 'application/json' } : {},
    body: args ? JSON.stringify(args) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const server = new McpServer({ name: 'figjam-bridge', version: '0.1.0' });

server.tool(
  'canvas_read',
  'Read the FigJam canvas: returns nodes, edges, strokes, a PNG snapshot, diff from last read, and any pending message the user sent from the plugin.',
  {},
  async () => {
    const result = await call('/canvas_read');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'canvas_write_sticky',
  'Place a sticky note on the FigJam canvas',
  {
    text: z.string().describe('Sticky note text'),
    x: z.number().describe('X position'),
    y: z.number().describe('Y position'),
    color: z.string().optional().describe('Color: yellow, pink, green, blue'),
  },
  async (args) => {
    const result = await call('/canvas_write_sticky', args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

server.tool(
  'canvas_write_text',
  'Place a text label on the FigJam canvas',
  {
    text: z.string().describe('Text content'),
    x: z.number().describe('X position'),
    y: z.number().describe('Y position'),
  },
  async (args) => {
    const result = await call('/canvas_write_text', args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

server.tool(
  'canvas_set_d2',
  'Push a D2 diagram to the canvas. Plugin renders it as structured nodes.',
  {
    d2_source: z.string().describe('D2 diagram source'),
  },
  async (args) => {
    const result = await call('/canvas_set_d2', args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

server.tool(
  'canvas_get_d2',
  'Get the current D2 diagram source from the canvas',
  {},
  async () => {
    const result = await call('/canvas_get_d2');
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

const transport = new StdioServerTransport();
server.connect(transport);
