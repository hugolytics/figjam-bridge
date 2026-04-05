import { WebSocketServer } from 'ws';

export function createWsServer(port = 3100) {
  const wss = new WebSocketServer({ port });
  let activeSocket = null;
  const pending = new Map(); // id -> { resolve, reject }
  let cmdCounter = 0;

  wss.on('connection', ws => {
    activeSocket = ws;
    ws.on('message', raw => {
      const msg = JSON.parse(raw.toString());
      const handler = pending.get(msg.id);
      if (handler) {
        pending.delete(msg.id);
        handler.resolve(msg.result);
      }
    });
    ws.on('close', () => {
      if (activeSocket === ws) activeSocket = null;
      for (const [id, { reject }] of pending) {
        pending.delete(id);
        reject(new Error('Plugin disconnected'));
      }
    });
  });

  return {
    wss,
    isConnected: () => activeSocket !== null && activeSocket.readyState === 1,
    send(command) {
      if (!activeSocket || activeSocket.readyState !== 1) {
        return Promise.reject(new Error('No plugin connected'));
      }
      const id = String(++cmdCounter);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        activeSocket.send(JSON.stringify({ ...command, id }));
      });
    },
    close() {
      return new Promise(resolve => wss.close(resolve));
    },
  };
}
