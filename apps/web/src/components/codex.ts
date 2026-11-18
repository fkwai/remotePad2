import { workspaceSocket } from '../connection';
import { button } from '../api';

export class CodexPanel {
  readonly element = document.createElement('div');
  private socket: WebSocket;
  constructor(id: string, status: (value: string) => void) {
    this.element.className = 'codex-body';
    const transcript = document.createElement('div');
    transcript.className = 'codex-transcript';
    const form = document.createElement('form');
    const input = document.createElement('textarea');
    input.setAttribute('aria-label', 'Message Codex');
    input.placeholder = 'Message the same conversation in Codex App';
    const submit = button('Send', () => {});
    submit.type = 'submit';
    form.append(input, submit);
    this.element.append(transcript, form);
    this.socket = new WebSocket(workspaceSocket('/ws/codex/' + id));
    this.socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.error) { submit.disabled = false; status(message.error); return; }
      if (message.sent) { input.value = ''; submit.disabled = false; return; }
      const bottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
      message.rows.forEach((row: { role: string; text: string }, index: number) => {
        let node = transcript.children[index] as HTMLElement | undefined;
        if (!node) {
          node = document.createElement('article');
          node.append(document.createElement('strong'), document.createElement('pre'));
          transcript.append(node);
        }
        if (node.children[0].textContent !== row.role) node.children[0].textContent = row.role;
        if (node.children[1].textContent !== row.text) node.children[1].textContent = row.text;
      });
      while (transcript.children.length > message.rows.length) transcript.lastElementChild?.remove();
      if (bottom) transcript.scrollTop = transcript.scrollHeight;
      status('Codex App · ' + message.status + (message.approvals ? ' · Answer pending requests in App' : ''));
    };
    this.socket.onclose = () => { submit.disabled = true; status('Codex App disconnected. Reopen this session.'); };
    form.onsubmit = (event) => {
      event.preventDefault();
      if (this.socket.readyState !== WebSocket.OPEN || !input.value.trim()) return;
      this.socket.send(JSON.stringify({ text: input.value }));
      submit.disabled = true;
    };
  }
  dispose() { this.socket.close(); }
}
