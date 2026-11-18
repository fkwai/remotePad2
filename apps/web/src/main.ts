import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { TerminalEvent, TerminalInput } from '@remotepad2/protocol';
import '@xterm/xterm/css/xterm.css';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header><strong>RemotePad<span>2</span></strong><div id="host">Local terminal</div></header>
  <main id="terminal" aria-label="Terminal"></main>
  <footer><span id="status" role="status">Connecting…</span><button id="restart" hidden>New terminal</button></footer>`;
const status = document.querySelector<HTMLSpanElement>('#status')!;
const host = document.querySelector<HTMLDivElement>('#host')!;
const restart = document.querySelector<HTMLButtonElement>('#restart')!;
const container = document.querySelector<HTMLElement>('#terminal')!;
const terminal = new Terminal({
  cursorBlink: true, fontSize: 14, fontFamily: 'Menlo, Consolas, monospace',
  scrollback: 5000, theme: { background: '#151719', foreground: '#dee3e7', cursor: '#a6d3b4' },
});
const fit = new FitAddon();
terminal.loadAddon(fit);
terminal.open(container);
let socket: WebSocket | undefined;
let ended = false;
function send(message: TerminalInput) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}
function resize() {
  fit.fit();
  send({ type: 'resize', cols: terminal.cols, rows: terminal.rows });
}
function connect() {
  ended = false;
  restart.hidden = true;
  status.textContent = 'Connecting…';
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/terminal`);
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data) as TerminalEvent;
    if (event.type === 'output') terminal.write(event.data);
    if (event.type === 'ready') {
      host.textContent = event.hostname;
      host.title = event.cwd;
      status.textContent = event.cwd;
      resize();
      terminal.focus();
    }
    if (event.type === 'exit' || event.type === 'error') {
      ended = true;
      status.textContent = event.type === 'exit' ? `Shell exited (${event.code})` : event.message;
    }
  };
  socket.onclose = () => {
    if (!ended) status.textContent = 'Disconnected';
    restart.hidden = false;
  };
  socket.onerror = () => { status.textContent = 'Could not connect to the terminal'; };
}
terminal.onData((data) => send({ type: 'input', data }));
new ResizeObserver(resize).observe(container);
restart.onclick = () => { terminal.reset(); connect(); };
window.addEventListener('pagehide', () => socket?.close());
connect();
