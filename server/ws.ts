import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { CourtRunner } from './court/runner.js';
export function attachWS(server: Server, runner: CourtRunner) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 4096,
    verifyClient: ({ origin }: { origin: string }) => {
      if (!origin) return true;
      try {
        return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
      } catch {
        return false;
      }
    },
  });
  const roles = new WeakMap<WebSocket, boolean>();
  const send = (ws: WebSocket, data: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  };
  wss.on('connection', (ws, req) => {
    const panel = new URL(req.url!, 'http://localhost').searchParams.get('role') === 'panel';
    roles.set(ws, panel);
    send(ws, { type: 'snapshot', data: runner.snapshot(panel), initial: true });
  });
  runner.onChange = () => {
    for (const ws of wss.clients)
      send(ws, { type: 'snapshot', data: runner.snapshot(roles.get(ws)) });
  };
  runner.onEvent = (event) => {
    for (const ws of wss.clients) send(ws, { type: 'event', data: event });
  };
  return wss;
}
