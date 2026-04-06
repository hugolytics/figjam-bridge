import { createWsServer } from './ws-server.js';
import { startMcpServer, buildTools } from './mcp-tools.js';
import { diffCanvas } from './canvas-diff.js';

const wsServer = createWsServer(3100);
const stateStore = {
  last: null,
  pendingMessage: null,  // { text, payload, timestamp } — set by plugin "Send to Claude"
};
const tools = buildTools(wsServer, stateStore);

wsServer.wss.on('connection', ws => {
  console.error('[bridge] plugin connected');
  ws.on('message', async raw => {
    const msg = JSON.parse(raw.toString());

    // User clicked "Send to Claude" in the plugin
    if (msg.event === 'user_message') {
      const diff = diffCanvas(stateStore.last, msg.payload);
      stateStore.last = msg.payload;
      stateStore.pendingMessage = {
        text: msg.text,
        payload: { ...msg.payload, diff_from_last: diff },
        timestamp: new Date().toISOString(),
      };
      console.error('[bridge] user_message stored:', msg.text?.slice(0, 80));
      return;
    }

    // All other messages are MCP tool responses — handled inside ws-server's pending map
  });
});

console.error('[bridge] WebSocket server listening on ws://localhost:3100');
startMcpServer(wsServer, stateStore);
