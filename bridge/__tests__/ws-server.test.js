import { createWsServer } from '../ws-server.js';
import { WebSocket } from 'ws';

let server, port;

beforeEach(async () => {
  server = createWsServer();
  await new Promise(resolve => server.wss.once('listening', resolve));
  port = server.wss.address().port;
});

afterEach(async () => {
  await server.close();
});

test('reports disconnected when no client', () => {
  expect(server.isConnected()).toBe(false);
});

test('reports connected after client connects', async () => {
  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise(resolve => ws.once('open', resolve));
  expect(server.isConnected()).toBe(true);
  ws.close();
});

test('send() rejects when no client connected', async () => {
  await expect(server.send({ type: 'get_snapshot' })).rejects.toThrow('No plugin connected');
});

test('send() resolves with plugin response', async () => {
  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise(resolve => ws.once('open', resolve));

  // Simulate plugin responding to command
  ws.on('message', raw => {
    const cmd = JSON.parse(raw);
    ws.send(JSON.stringify({ id: cmd.id, result: { ok: true } }));
  });

  const result = await server.send({ type: 'ping' });
  expect(result).toEqual({ ok: true });
  ws.close();
});
