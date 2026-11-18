import type { CodexSession, SessionInfo } from '@remotepad2/protocol';
import { api, button } from '../api';

export class SessionsIndex {
  readonly element = document.createElement('section');
  private running = document.createElement('div');
  private codex = document.createElement('div');
  private error = document.createElement('div');
  constructor(private open: (session: SessionInfo) => void, create: () => void, resume: (id: string) => Promise<void>) {
    this.element.className = 'index sessions-index';
    this.element.setAttribute('aria-label', 'Sessions Index');
    const heading = document.createElement('h2');
    heading.textContent = 'Sessions Index';
    const codexHeading = document.createElement('div');
    codexHeading.className = 'index-modes';
    codexHeading.append(document.createTextNode('Codex'), button('↻', () => void load(), 'Refresh Codex sessions'));
    const load = async () => {
      this.error.textContent = '';
      try {
        const { sessions } = await api<{ sessions: CodexSession[] }>('/api/codex/sessions');
        this.codex.replaceChildren();
        if (!sessions.length) this.codex.textContent = 'No Codex sessions';
        for (const session of sessions) {
          const row = button('', () => {
            row.disabled = true;
            void resume(session.id).catch((error) => { this.error.textContent = error.message; })
              .finally(() => { row.disabled = false; });
          }, session.cwd + '\nResume in a terminal');
          row.className = 'codex-row';
          const title = document.createElement('span');
          title.textContent = session.title;
          const detail = document.createElement('small');
          detail.textContent = session.cwd.split('/').pop() + ' · ' + new Date(session.updatedAt).toLocaleDateString();
          row.append(title, detail);
          this.codex.append(row);
        }
      } catch (error) { this.error.textContent = (error as Error).message; }
    };
    this.error.className = 'error';
    this.element.append(heading, button('+ New shell', create), this.running, codexHeading, this.error, this.codex);
    void load();
  }
  render(sessions: SessionInfo[], active: string) {
    this.running.replaceChildren();
    for (const session of sessions) {
      const row = button(`${session.name} · ${session.alive ? 'Running' : 'Exited'}`,
        () => this.open(session), session.cwd + '\n' + session.id);
      row.className = 'session-row' + (session.id === active ? ' active' : '');
      this.running.append(row);
    }
  }
}
