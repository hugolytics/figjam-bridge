import { buildTools } from '../mcp-tools.js';

function makeMockWs(responseForCommand) {
  return {
    isConnected: () => true,
    send: async (cmd) => responseForCommand(cmd),
  };
}

test('canvas_read returns structured payload with diff', async () => {
  const fakePayload = {
    nodes: [{ id: 'n1', text: 'idea', x: 0, y: 0, w: 100, h: 50, type: 'sticky' }],
    edges: [],
    strokes: [],
    snapshot_png: 'base64abc',
  };
  const ws = makeMockWs(() => fakePayload);
  const stateStore = { last: null };
  const tools = buildTools(ws, stateStore);

  const result = await tools.canvas_read.execute({});
  expect(result.nodes).toHaveLength(1);
  expect(result.diff.added_nodes).toContain('n1');
  expect(result.snapshot_png).toBe('base64abc');
});

test('canvas_write_sticky sends correct command', async () => {
  let sent;
  const ws = makeMockWs(cmd => { sent = cmd; return { node_id: 'new1' }; });
  const tools = buildTools(ws, { last: null });

  const result = await tools.canvas_write_sticky.execute({ text: 'hello', x: 10, y: 20 });
  expect(sent.type).toBe('create_sticky');
  expect(sent.text).toBe('hello');
  expect(result.node_id).toBe('new1');
});

test('canvas_set_d2 sends update_d2 command', async () => {
  let sent;
  const ws = makeMockWs(cmd => { sent = cmd; return { ok: true }; });
  const tools = buildTools(ws, { last: null });

  await tools.canvas_set_d2.execute({ d2_source: 'a -> b' });
  expect(sent.type).toBe('update_d2');
  expect(sent.d2_source).toBe('a -> b');
});

test('canvas_read throws when plugin not connected', async () => {
  const ws = { isConnected: () => false, send: async () => {} };
  const tools = buildTools(ws, { last: null });
  await expect(tools.canvas_read.execute({})).rejects.toThrow('Plugin not connected');
});
