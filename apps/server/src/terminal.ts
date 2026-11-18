import os from 'node:os';
import pty from 'node-pty';
import type { FastifyInstance } from 'fastify';
import type { TerminalEvent } from '@remotepad2/protocol';

export async function registerTerminal(app: FastifyInstance) {
  const terminals = new Set<pty.IPty>();
  app.addHook('onClose', async () => {
    for (const terminal of terminals) terminal.kill();
  });
  app.get('/ws/terminal', { websocket: true }, (socket, request) => {
    // WebSocket upgrades must come from the app, including in development.
    if (!request.headers.origin) {
      socket.close(1008, 'Browser origin required');
      return;
    }
    const send = (event: TerminalEvent) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(event));
    };
    let terminal: pty.IPty;
    try {
      terminal = pty.spawn(process.env.SHELL || '/bin/bash', ['-l'], {
        name: 'xterm-256color', cols: 80, rows: 24, cwd: os.homedir(),
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });
    } catch (error) {
      send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      socket.close(1011, 'Could not start shell');
      return;
    }
    terminals.add(terminal);
    send({ type: 'ready', hostname: os.hostname(), cwd: os.homedir() });
    const data = terminal.onData((chunk) => {
      if (socket.readyState !== 1) return;
      if (socket.bufferedAmount > 2 * 1024 * 1024) terminal.pause();
      socket.send(JSON.stringify({ type: 'output', data: chunk } satisfies TerminalEvent), (error) => {
        if (error) socket.close();
        else if (socket.bufferedAmount < 256 * 1024) terminal.resume();
      });
    });
    const exit = terminal.onExit(({ exitCode }) => {
      send({ type: 'exit', code: exitCode });
      terminals.delete(terminal);
      socket.close(1000, 'Shell exited');
    });
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(String(raw));
        if (message.type === 'input' && typeof message.data === 'string' && message.data.length <= 65536) {
          terminal.write(message.data);
        } else if (message.type === 'resize' && Number.isInteger(message.cols) && Number.isInteger(message.rows)) {
          terminal.resize(Math.max(2, Math.min(500, message.cols)), Math.max(1, Math.min(300, message.rows)));
        }
      } catch { send({ type: 'error', message: 'Invalid terminal message' }); }
    });
    socket.on('close', () => { data.dispose(); exit.dispose(); terminals.delete(terminal); terminal.kill(); });
    socket.on('error', () => socket.close());
  });
}
