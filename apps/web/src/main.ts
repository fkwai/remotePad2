import type { FileContent, SessionInfo } from '@remotepad2/protocol';
import { api, button } from './api';
import { workspaceKey } from './connection';
import { connectionsButton } from './components/connections';
import { CodexPanel } from './components/codex';
import { TerminalPanel } from './components/terminal';
import { EditorPanel } from './components/editor';
import { FilesIndex } from './components/files';
import { SessionsIndex } from './components/sessions';
import '@xterm/xterm/css/xterm.css';
import './style.css';

document.querySelector('#app')!.innerHTML = `
<header><strong>RemotePad<span>2</span></strong><nav id="controls"></nav><div id="host"></div></header>
<main id="workbench"><aside id="files-index"></aside><div id="workspace"><section id="editor" class="panel">
<div class="tabs" id="editor-tabs"></div><div id="editor-content" class="panel-content"></div></section>
<section id="terminal" class="panel"><div class="tabs" id="terminal-tabs"></div><div id="terminal-content" class="panel-content"></div></section></div><aside id="sessions-index"></aside></main>
<footer id="status" role="status">Ready</footer>`;
const get = (id: string) => document.getElementById(id)!;
const status = (message: string) => { get('status').textContent = message; };
const terminals = new Map<string, { info: SessionInfo; panel: TerminalPanel | CodexPanel }>();
const editors = new Map<string, EditorPanel>();
let activeSession = '';
let activeFile = '';
let sessionList: SessionInfo[] = [];
const visibility: Record<string, boolean> = { files: true, sessions: true, editor: true, terminal: true };
try {
  const saved = JSON.parse(localStorage.getItem(workspaceKey('fixed-visibility')) || '{}');
  for (const key of Object.keys(visibility)) if (typeof saved?.[key] === 'boolean') visibility[key] = saved[key];
} catch { /* A malformed layout starts with the default components. */ }
function layout() {
  files.element.hidden = !visibility.files;
  sessions.element.hidden = !visibility.sessions;
  get('files-index').hidden = !visibility.files;
  get('sessions-index').hidden = !visibility.sessions;
  get('editor').hidden = !visibility.editor;
  get('terminal').hidden = !visibility.terminal;
  get('workbench').classList.toggle('has-index', visibility.files || visibility.sessions);
  for (const control of Array.from(get('controls').querySelectorAll('button'))) control.setAttribute('aria-pressed', String(Boolean(visibility[control.dataset.component!])));
  localStorage.setItem(workspaceKey('fixed-visibility'), JSON.stringify(visibility));
}
for (const [id, label] of [['files', 'Files Index'], ['sessions', 'Sessions Index'], ['editor', 'Editor'], ['terminal', 'Terminal']]) {
  const control = button(label, () => { visibility[id] = !visibility[id]; layout(); });
  control.dataset.component = id;
  get('controls').append(control);
}
function renderTerminals() {
  const tabs = [...terminals].map(([id, { info, panel }]) => {
    panel.element.hidden = id !== activeSession;
    const tab = document.createElement('div');
    tab.className = 'tab' + (id === activeSession ? ' active' : '');
    tab.append(button(info.name + ' ' + id.slice(0, 6), () => openSession(info)), button('×', () => void closeSession(id), 'Close tab and end session'));
    return tab;
  });
  get('terminal-tabs').replaceChildren(...tabs, button('+', () => void createSession(), 'New shell'));
  sessions.render([...sessionList, ...[...terminals.values()].filter((t) => t.info.kind === 'codex-app').map((t) => t.info)], activeSession);
}
function openSession(info: SessionInfo) {
  activeSession = info.id;
  if (!terminals.has(info.id)) {
    const report = (message: string) => { if (activeSession === info.id) status(message); };
    const panel = info.kind === 'codex-app' ? new CodexPanel(info.codexId!, report) : new TerminalPanel(info.id, report);
    terminals.set(info.id, { info, panel });
    get('terminal-content').append(panel.element);
  }
  visibility.terminal = true;
  localStorage.setItem(workspaceKey('session'), info.id);
  renderTerminals();
  layout();
}
async function closeSession(id: string) {
  try {
    if (terminals.get(id)?.info.kind !== 'codex-app') await api('/api/sessions/' + id, { method: 'DELETE' });
    const terminal = terminals.get(id);
    terminal?.panel.dispose();
    terminal?.panel.element.remove();
    terminals.delete(id);
    sessionList = sessionList.filter((s) => s.id !== id);
    if (id === activeSession) activeSession = [...terminals.keys()].at(-1) || '';
    localStorage.setItem(workspaceKey('session'), activeSession);
    renderTerminals();
  } catch (error) { status((error as Error).message); }
}
async function createSession() {
  try { const info = await api<SessionInfo>('/api/sessions', { method: 'POST' }); await refresh(); openSession(info); }
  catch (error) { status((error as Error).message); }
}
function renderEditors() {
  get('editor-tabs').replaceChildren(...[...editors].map(([path, editor]) => {
    editor.element.hidden = path !== activeFile;
    const tab = document.createElement('div');
    tab.className = 'tab' + (path === activeFile ? ' active' : '');
    tab.append(button((editor.dirty ? '● ' : '') + path.split('/').pop(), () => { activeFile = path; renderEditors(); }, path),
      button('×', () => {
        if (editor.dirty && !confirm('Discard unsaved changes in ' + path + '?')) return;
        editor.element.remove();
        editors.delete(path);
        if (activeFile === path) activeFile = [...editors.keys()].at(-1) || '';
        renderEditors();
      }, 'Close file'));
    return tab;
  }));
}
async function openFile(path: string) {
  try {
    if (!editors.has(path)) {
      const data = await api<FileContent>('/api/file?path=' + encodeURIComponent(path));
      const panel = new EditorPanel(data, renderEditors, status);
      editors.set(path, panel);
      get('editor-content').append(panel.element);
    }
    activeFile = path;
    visibility.editor = true;
    renderEditors();
    layout();
  } catch (error) { status((error as Error).message); }
}
const files = new FilesIndex((path) => void openFile(path), (path) => localStorage.setItem(workspaceKey('directory'), path));
const sessions = new SessionsIndex(openSession, () => void createSession(), async (codexId) => {
  const info = await api<SessionInfo>('/api/sessions', { method: 'POST', body: JSON.stringify({ codexId }) });
  await refresh();
  openSession(info);
}, (metadata) => {
  for (const terminal of terminals.values()) {
    const info = metadata.find((session) => session.id === terminal.info.codexId);
    if (info) terminal.info.name = info.title;
  }
  renderTerminals();
});
get('files-index').append(files.element);
get('sessions-index').append(sessions.element);
async function refresh() {
  const result = await api<{ sessions: SessionInfo[] }>('/api/sessions');
  sessionList = result.sessions;
  for (const [id, terminal] of terminals) {
    if (terminal.info.kind === 'codex-app') continue;
    const info = sessionList.find((s) => s.id === id);
    if (info) terminal.info = info;
    else {
      terminal.panel.dispose();
      terminal.panel.element.remove();
      terminals.delete(id);
      if (activeSession === id) activeSession = [...terminals.keys()].at(-1) || '';
    }
  }
  renderTerminals();
}
async function start() {
  try {
    const health = await api<{ hostname: string }>('/api/health');
    connectionsButton(get('host'), status);
    await refresh();
    const savedId = localStorage.getItem(workspaceKey('session'));
    if (savedId?.startsWith('app:')) {
      const info = await api<SessionInfo>('/api/sessions', { method: 'POST', body: JSON.stringify({ codexId: savedId.slice(4) }) });
      openSession(info);
      layout();
      return;
    }
    const previous = sessionList.find((s) => s.id === savedId);
    if (previous) openSession(previous);
    else if (sessionList.length) openSession(sessionList[0]);
    else await createSession();
    layout();
  } catch (error) { status((error as Error).message); }
}
window.addEventListener('beforeunload', (event) => {
  if ([...editors.values()].some((editor) => editor.dirty)) { event.preventDefault(); event.returnValue = ''; }
});
window.setInterval(() => { void refresh().catch(() => status('Backend unavailable')); }, 2500);
layout();
void start();
