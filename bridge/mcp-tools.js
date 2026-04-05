import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { diffCanvas } from './canvas-diff.js';

export function buildTools(wsServer, stateStore) {
  return {
    canvas_read: {
      execute: async () => {
        if (!wsServer.isConnected()) throw new Error('Plugin not connected');
        const payload = await wsServer.send({ type: 'get_snapshot' });
        const diff = diffCanvas(stateStore.last, payload);
        stateStore.last = payload;
        return { ...payload, diff };
      },
    },
    canvas_write_sticky: {
      execute: async ({ text, x, y, color }) => {
        if (!wsServer.isConnected()) throw new Error('Plugin not connected');
        return wsServer.send({ type: 'create_sticky', text, x, y, color });
      },
    },
    canvas_write_text: {
      execute: async ({ text, x, y }) => {
        if (!wsServer.isConnected()) throw new Error('Plugin not connected');
        return wsServer.send({ type: 'create_text', text, x, y });
      },
    },
    canvas_set_d2: {
      execute: async ({ d2_source }) => {
        if (!wsServer.isConnected()) throw new Error('Plugin not connected');
        return wsServer.send({ type: 'update_d2', d2_source });
      },
    },
    canvas_get_d2: {
      execute: async () => {
        if (!wsServer.isConnected()) throw new Error('Plugin not connected');
        return wsServer.send({ type: 'get_d2' });
      },
    },
  };
}

export function startMcpServer(wsServer, stateStore) {
  const tools = buildTools(wsServer, stateStore);
  const server = new McpServer({ name: 'figjam-bridge', version: '0.1.0' });

  server.tool('canvas_read', 'Read canvas state: all nodes, edges, strokes, PNG snapshot, and diff from last read', {}, async () => {
    const result = await tools.canvas_read.execute({});
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.tool('canvas_write_sticky', 'Place a sticky note on the canvas', {
    text: z.string().describe('Sticky note text'),
    x: z.number().describe('X position in canvas coordinates'),
    y: z.number().describe('Y position in canvas coordinates'),
    color: z.string().optional().describe('Color name: yellow, pink, green, blue'),
  }, async (args) => {
    const result = await tools.canvas_write_sticky.execute(args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.tool('canvas_write_text', 'Place a text label on the canvas', {
    text: z.string().describe('Text content'),
    x: z.number().describe('X position'),
    y: z.number().describe('Y position'),
  }, async (args) => {
    const result = await tools.canvas_write_text.execute(args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.tool('canvas_set_d2', 'Push a D2 diagram source. Plugin renders it as structured nodes with layout.', {
    d2_source: z.string().describe('D2 diagram source text'),
  }, async (args) => {
    const result = await tools.canvas_set_d2.execute(args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.tool('canvas_get_d2', 'Get the current canonical D2 source from the canvas', {}, async () => {
    const result = await tools.canvas_get_d2.execute({});
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  const transport = new StdioServerTransport();
  server.connect(transport);
  console.error('[bridge] MCP server listening on stdio');
}
