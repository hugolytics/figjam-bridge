import { buildClaudeHandler, createOpenRouterClient } from '../claude-client.js';

test('calls client with canvas payload and returns parsed response', async () => {
  const fakeResponse = {
    message: 'I see a pipeline',
    writes: [{ tool: 'canvas_write_sticky', args: { text: 'Step 1', x: 0, y: 0 } }],
  };

  const mockClient = {
    complete: async () => JSON.stringify(fakeResponse),
  };

  const handler = buildClaudeHandler(mockClient);
  const result = await handler({ nodes: [], edges: [], strokes: [], snapshot_png: 'abc' });

  expect(result.message).toBe('I see a pipeline');
  expect(result.writes).toHaveLength(1);
  expect(result.writes[0].tool).toBe('canvas_write_sticky');
});

test('returns plain message string if model returns non-JSON', async () => {
  const mockClient = {
    complete: async () => 'Just a plain response',
  };
  const handler = buildClaudeHandler(mockClient);
  const result = await handler({ nodes: [], edges: [], strokes: [], snapshot_png: '' });
  expect(result.message).toBe('Just a plain response');
  expect(result.writes).toEqual([]);
});

test('createOpenRouterClient throws if no API key', () => {
  expect(() => createOpenRouterClient(undefined)).toThrow('OPENROUTER_API_KEY is not set');
});
