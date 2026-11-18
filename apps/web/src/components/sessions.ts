import type { SessionInfo } from '@remotepad2/protocol';
import { button } from '../api';

export class SessionsIndex {
  readonly element = document.createElement('section');
  constructor(private open: (session: SessionInfo) => void, create: () => void) {
    this.element.className = 'index';
    this.element.setAttribute('aria-label', 'Sessions Index');
    const heading = document.createElement('h2');
    heading.textContent = 'Sessions Index';
    this.element.append(heading, button('+ New shell', create));
  }
  render(sessions: SessionInfo[], active: string) {
    this.element.querySelectorAll('.session-row').forEach((node) => node.remove());
    for (const session of sessions) {
      const row = button(`${session.name} · ${session.alive ? 'Running' : 'Exited'} · ${session.id.slice(0, 6)}`,
        () => this.open(session), session.cwd);
      row.className = 'session-row' + (session.id === active ? ' active' : '');
      this.element.append(row);
    }
  }
}
