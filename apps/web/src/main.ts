import { menu } from './components/menu';
import { Layout } from './components/layout';
import { workspaceMenu } from './components/workspaces';
import type { FileContent, SessionInfo } from '@remotepad2/protocol';
import { api, button } from './api';
import { workspaceKey } from './connection';
import { connectionsButton } from './components/connections';
import { CodexPanel } from './components/codex';
import { TerminalPanel } from './components/terminal';
import { FolderPanel } from './components/folder';
import { isImage } from './components/render';
import { EditorPanel } from './components/editor';
import { FilesIndex } from './components/files';
import { SessionsIndex } from './components/sessions';
import '@xterm/xterm/css/xterm.css';
import './style.css';

document.querySelector('#app')!.innerHTML = `
<header><div id="version"></div><nav id="controls"></nav><div id="host"></div></header>
<main id="workbench"><aside id="files-index"></aside><div id="workspace"><section id="editor" class="panel">
<div class="tabs" id="editor-tabs"></div><div id="editor-content" class="panel-content"></div></section>
<section id="terminal" class="panel"><div class="tabs" id="terminal-tabs"></div><div id="terminal-content" class="panel-content"></div></section></div><aside id="sessions-index"></aside></main>
<footer id="status" role="status">Ready</footer>`;
const get = (id: string) => document.getElementById(id)!;
const status = (message: string) => { get('status').textContent = message; };
const terminals = new Map<string, { info: SessionInfo; panel: TerminalPanel | CodexPanel }>();
const editors = new Map<string, EditorPanel | FolderPanel>();
let activeSession = '';
let activeFile = '';
let sessionList: SessionInfo[] = [];
const panels = new Layout(get);
const visibility = panels.visible;
const layout = () => panels.apply();
panels.menu(get('controls'));
workspaceMenu(get('version'));
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
  localStorage.setItem(workspaceKey('editor-tabs'), JSON.stringify([...editors].map(([path, panel]) => panel instanceof FolderPanel ? { folder: panel.path } : { file: path })));
  const active = editors.get(activeFile);
  localStorage.setItem(workspaceKey('active-file'), active instanceof FolderPanel ? 'folder:' + active.path : activeFile);
  get('editor-tabs').replaceChildren(...[...editors].map(([path, editor]) => {
    editor.element.hidden = path !== activeFile;
    const tab = document.createElement('div');
    tab.className = 'tab' + (editor instanceof FolderPanel ? ' folder-tab' : '') + (path === activeFile ? ' active' : '');
    tab.oncontextmenu = (event) => menu(event, [
      ...(editor instanceof FolderPanel ? [{ label: 'Refresh folder', action: () => editor.refresh() }] : []),
      { label: 'Close', action: () => (tab.lastElementChild as HTMLButtonElement).click() },
    ]);
    tab.append(button((editor.dirty ? '● ' : '') + (editor instanceof FolderPanel ? editor.label : path.split('/').pop()), () => { activeFile = path; renderEditors(); }, path),
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
      const data = isImage(path) ? { path, content: '', revision: '' } : await api<FileContent>('/api/file?path=' + encodeURIComponent(path));
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
function openFolder(directory: string) {
  const key = 'folder:' + directory;
  if (!editors.has(key)) {
    const panel = new FolderPanel(directory, (path) => void openFile(path), renderEditors, status);
    editors.set(key, panel);
    get('editor-content').append(panel.element);
  }
  activeFile = key;
  visibility.editor = true;
  renderEditors();
  layout();
}
const files = new FilesIndex((path) => void openFile(path), (path) => localStorage.setItem(workspaceKey('directory'), path), openFolder);
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
    const savedTabs = JSON.parse(localStorage.getItem(workspaceKey('editor-tabs')) || '[]');
    const savedActive = localStorage.getItem(workspaceKey('active-file'));
    const savedVisibility = { ...visibility };
    for (const tab of Array.isArray(savedTabs) ? savedTabs : []) {
      if (typeof tab.folder === 'string') openFolder(tab.folder);
      else if (typeof tab.file === 'string') await openFile(tab.file);
    }
    if (savedActive && editors.has(savedActive)) { activeFile = savedActive; renderEditors(); }
    const health = await api<{ hostname: string }>('/api/health');
    connectionsButton(get('host'), status);
    await refresh();
    const savedId = localStorage.getItem(workspaceKey('session'));
    if (savedId?.startsWith('app:')) {
      const info = await api<SessionInfo>('/api/sessions', { method: 'POST', body: JSON.stringify({ codexId: savedId.slice(4) }) });
      openSession(info);
      Object.assign(visibility, savedVisibility); layout();
      return;
    }
    const previous = sessionList.find((s) => s.id === savedId);
    if (previous) openSession(previous);
    else await createSession();
    Object.assign(visibility, savedVisibility); layout();
  } catch (error) { status((error as Error).message); }
}
window.addEventListener('beforeunload', (event) => {
  if ([...editors.values()].some((editor) => editor.dirty)) { event.preventDefault(); event.returnValue = ''; }
});
window.setInterval(() => { void refresh().catch(() => status('Backend unavailable')); }, 2500);
layout();
void start();
