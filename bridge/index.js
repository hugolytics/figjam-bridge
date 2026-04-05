import { createWsServer } from './ws-server.js';
import { startMcpServer, buildTools } from './mcp-tools.js';
import { buildClaudeHandler, createOpenRouterClient } from './claude-client.js';
import { diffCanvas } from './canvas-diff.js';

const wsServer = createWsServer(3100);
const stateStore = { last: null };
const tools = buildTools(wsServer, stateStore);

const client = createOpenRouterClient(process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_MODEL);
const handleAskClaude = buildClaudeHandler(client);

// Handle plugin-initiated "Ask Claude"
wsServer.wss.on('connection', ws => {
  ws.on('message', async raw => {
    const msg = JSON.parse(raw.toString());
    if (msg.event === 'ask_claude') {
      try {
        // Enrich payload with diff from last known state, then update stateStore
        const diff = diffCanvas(stateStore.last, msg.payload);
        stateStore.last = msg.payload;
        const enrichedPayload = { ...msg.payload, diff_from_last: diff };

        const result = await handleAskClaude(enrichedPayload);
        // Place Claude's message as a sticky in the top-right corner of the frame
        const { nodes } = msg.payload;
        const maxX = nodes.length ? Math.max(...nodes.map(n => n.x + n.w)) : 0;
        await tools.canvas_write_sticky.execute({
          text: `Claude: ${result.message}`,
          x: maxX + 40,
          y: 0,
          color: 'blue',
        });
        // Execute any additional writes Claude requested
        for (const write of result.writes ?? []) {
          if (tools[write.tool]) {
            await tools[write.tool].execute(write.args);
          }
        }
      } catch (err) {
        console.error('[bridge] ask_claude error:', err.message);
      }
    }
  });
});

console.error('[bridge] WebSocket server listening on ws://localhost:3100');
startMcpServer(wsServer, stateStore);
