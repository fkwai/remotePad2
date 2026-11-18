import os from 'node:os';
import { randomUUID } from 'node:crypto';
import pty from 'node-pty';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { appOwner } from './codex-app.ts';
import { codexSessions } from './codex.ts';
import type { SessionInfo, TerminalEvent } from '@remotepad2/protocol';

interface Session {
  info: SessionInfo;
  process: pty.IPty;
  replay: string;
  clients: Set<WebSocket>;
}
export async function registerTerminal(app: FastifyInstance) {
  const sessions = new Map<string, Session>();
  const send = (socket: WebSocket, event: TerminalEvent) => {
    if (socket.readyState !== 1) return;
    // A slow viewer disconnects and can reconnect to the bounded replay.
    if (socket.bufferedAmount > 2 * 1024 * 1024) { socket.close(1013, 'Viewer too slow'); return; }
    socket.send(JSON.stringify(event));
  };
  app.addHook('onClose', async () => {
    for (const session of sessions.values()) if (session.info.alive) session.process.kill();
  });
  app.get('/api/sessions', async () => ({ sessions: [...sessions.values()].map((s) => s.info) }));
  app.get('/api/codex/sessions', async (_req, reply) => {
    try { return { sessions: codexSessions() }; }
    catch (error) { return reply.code(503).send({ error: (error as Error).message }); }
  });
  app.post<{ Body: { codexId?: string } }>('/api/sessions', async (req, reply) => {
    const codexId = req.body?.codexId;
    const attached = codexId ? [...sessions.values()].find((session) => session.info.codexId === codexId && session.info.alive) : undefined;
    const existing = codexId ? codexSessions().find((session) => session.id === codexId) : undefined;
    if (codexId && !existing) return reply.code(404).send({ error: 'Codex session unavailable.' });
    if (existing) {
      const owner = await appOwner(existing.id).catch(() => null);
      if (owner) return { id: 'app:' + existing.id, codexId: existing.id, kind: 'codex-app',
        name: existing.title, cwd: existing.cwd, alive: true };
    }
    if (attached) return attached.info;
    const cwd = existing?.cwd || os.homedir();
    let process: pty.IPty;
    try {
      process = pty.spawn(existing ? 'codex' : os.userInfo().shell || '/bin/bash',
        existing ? ['resume', existing.id, '--no-alt-screen'] : ['-l'], {
      name: 'xterm-256color', cols: 80, rows: 24, cwd,
      env: { ...globalThis.process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
    } catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
    const session: Session = {
      info: { id: randomUUID(), name: existing ? existing.title : 'Shell', cwd, codexId: existing?.id, alive: true },
      process, replay: '', clients: new Set(),
    };
    sessions.set(session.info.id, session);
    process.onData((data) => {
      session.replay = (session.replay + data).slice(-200_000);
      for (const client of session.clients) send(client, { type: 'output', data });
    });
    process.onExit(({ exitCode }) => {
      session.info.alive = false;
      session.info.exitCode = exitCode;
      for (const client of session.clients) send(client, { type: 'exit', code: exitCode });
    });
    return session.info;
  });
  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req) => {
    const session = sessions.get(req.params.id);
    if (session) {
      if (session.info.alive) session.process.kill();
      for (const client of session.clients) client.close(1000, 'Session closed');
      sessions.delete(req.params.id);
    }
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>('/ws/terminal/:id', { websocket: true }, (socket, req) => {
    if (!req.headers.origin && !process.env.REMOTEPAD2_WORKER_SOCKET) { socket.close(1008, 'Browser origin required'); return; }
    const session = sessions.get(req.params.id);
    if (!session) { socket.close(1008, 'Session unavailable'); return; }
    session.clients.add(socket);
    send(socket, { type: 'ready', session: session.info, replay: session.replay });
    if (!session.info.alive) send(socket, { type: 'exit', code: session.info.exitCode || 0 });
    socket.on('message', (raw) => {
      if (!session.info.alive) return;
      try {
        const message = JSON.parse(String(raw));
        if (message.type === 'input' && typeof message.data === 'string' && message.data.length <= 65536) {
          session.process.write(message.data);
        } else if (message.type === 'resize' && Number.isInteger(message.cols) && Number.isInteger(message.rows)) {
          session.process.resize(Math.max(2, Math.min(500, message.cols)), Math.max(1, Math.min(300, message.rows)));
        }
      } catch { send(socket, { type: 'error', message: 'Invalid terminal message' }); }
    });
    socket.on('close', () => session.clients.delete(socket));
    socket.on('error', () => socket.close());
  });
}
