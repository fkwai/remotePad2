import { workspaceSocket } from '../connection';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { TerminalEvent, TerminalInput } from '@remotepad2/protocol';

export class TerminalPanel {
  readonly element = document.createElement('div');
  private terminal = new Terminal({
    cursorBlink: true, fontSize: 14, fontFamily: 'Menlo, Consolas, monospace',
    scrollback: 5000, theme: { background: '#151719', foreground: '#dee3e7', cursor: '#a6d3b4' },
  });
  private fit = new FitAddon();
  private socket?: WebSocket;
  private observer: ResizeObserver;
  private disposed = false;
  private retry?: number;
  constructor(id: string, status: (value: string) => void) {
    this.element.className = 'terminal-body';
    this.element.setAttribute('aria-label', 'Terminal');
    this.terminal.loadAddon(this.fit);
    this.terminal.open(this.element);
    const resize = () => {
      if (!this.element.clientWidth || !this.element.clientHeight) return;
      this.fit.fit();
      this.send({ type: 'resize', cols: this.terminal.cols, rows: this.terminal.rows });
    };
    this.observer = new ResizeObserver(resize);
    this.observer.observe(this.element);
    this.terminal.onData((data) => this.send({ type: 'input', data }));
    const connect = () => {
      status('Connecting…');
      const socket = new WebSocket(workspaceSocket('/ws/terminal/' + id));
      this.socket = socket;
      socket.onmessage = ({ data }) => {
        const event = JSON.parse(data) as TerminalEvent;
        if (event.type === 'ready') {
          this.terminal.reset();
          this.terminal.write(event.replay);
          status(event.session.alive ? event.session.cwd : `Exited (${event.session.exitCode})`);
          resize();
          if (!document.activeElement || document.activeElement === document.body || this.element.contains(document.activeElement)) this.terminal.focus();
        }
        if (event.type === 'output') this.terminal.write(event.data);
        if (event.type === 'exit') status(`Exited (${event.code})`);
        if (event.type === 'error') status(event.message);
      };
      socket.onclose = ({ code }) => {
        if (this.disposed) return;
        status(code === 1000 || code === 1008 ? 'Session closed' : 'Disconnected · reconnecting…');
        if (code !== 1000 && code !== 1008) this.retry = window.setTimeout(connect, 1500);
      };
    };
    connect();
  }
  private send(event: TerminalInput) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.retry);
    this.socket?.close();
    this.observer.disconnect();
    this.terminal.dispose();
  }
}
