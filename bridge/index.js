import http from 'http';
import { createWsServer } from './ws-server.js';
import { buildTools } from './mcp-tools.js';
import { diffCanvas } from './canvas-diff.js';

const wsServer = createWsServer(3100);
const stateStore = {
  last: null,
  pendingMessage: null,
};
const tools = buildTools(wsServer, stateStore);

// ---- Plugin WebSocket messages ----
wsServer.wss.on('connection', ws => {
  console.error('[bridge] plugin connected');
  ws.on('message', async raw => {
    const msg = JSON.parse(raw.toString());
    if (msg.event === 'user_message') {
      const diff = diffCanvas(stateStore.last, msg.payload);
      stateStore.last = msg.payload;
      stateStore.pendingMessage = {
        text: msg.text,
        payload: { ...msg.payload, diff_from_last: diff },
        timestamp: new Date().toISOString(),
      };
      console.error('[bridge] user_message stored:', msg.text?.slice(0, 80));
    }
  });
});

// ---- HTTP API on port 3101 for MCP proxy ----
const httpServer = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (!wsServer.isConnected()) {
    res.writeHead(503);
    res.end(JSON.stringify({ error: 'Plugin not connected' }));
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  await new Promise(resolve => req.on('end', resolve));
  const args = body ? JSON.parse(body) : {};

  try {
    let result;
    const path = req.url;

    if (path === '/canvas_read') {
      result = await tools.canvas_read.execute({});
      const pending = stateStore.pendingMessage;
      stateStore.pendingMessage = null;
      result.user_message = pending ?? null;
    } else if (path === '/canvas_write_sticky') {
      result = await tools.canvas_write_sticky.execute(args);
    } else if (path === '/canvas_write_text') {
      result = await tools.canvas_write_text.execute(args);
    } else if (path === '/canvas_set_d2') {
      result = await tools.canvas_set_d2.execute(args);
    } else if (path === '/canvas_get_d2') {
      result = await tools.canvas_get_d2.execute({});
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Unknown endpoint: ' + path }));
      return;
    }

    res.writeHead(200);
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
});

httpServer.listen(3101, () => {
  console.error('[bridge] HTTP API listening on http://localhost:3101');
});

console.error('[bridge] WebSocket server listening on ws://localhost:3100');
