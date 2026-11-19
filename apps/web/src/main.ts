import { initializeWindow, startWindowSave } from './windows';
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

await initializeWindow();
document.querySelector('#app')!.innerHTML = `
<header><div id="version"></div><nav id="controls"></nav><div class="header-right"><div id="layout-menu"></div><div id="host"></div></div></header>
<main id="workbench"><aside id="files-index"></aside><div id="workspace"><section id="editor" class="panel">
<div id="editor-panes"><div id="primary-editor" class="editor-pane"><div class="tabs" id="editor-tabs"></div><div id="editor-content" class="panel-content"></div></div><div id="editor-divider" role="separator" aria-label="Editor split width" hidden></div><div id="secondary-editor" class="editor-pane" hidden><div class="tabs" id="secondary-tabs"></div><div id="secondary-content" class="panel-content"></div></div></div></section>
<section id="terminal" class="panel"><div class="tabs" id="terminal-tabs"></div><div id="terminal-content" class="panel-content"></div></section></div><aside id="sessions-index"></aside></main>
<footer id="status" role="status">Ready</footer>`;
const get = (id: string) => document.getElementById(id)!;
const status = (message: string) => { get('status').textContent = message; };
const terminals = new Map<string, { info: SessionInfo; panel: TerminalPanel | CodexPanel }>();
const editors = new Map<string, EditorPanel | FolderPanel>();
let activeSession = '';
let activeFile = '';
let secondaryFile = '';
let focusedPane: 'left' | 'right' = 'left';
let splitOpen = localStorage.getItem(workspaceKey('editor-split')) === 'true';
let splitRatio = Number(localStorage.getItem(workspaceKey('editor-ratio'))) || 0.5;
const secondary = new Map<string, EditorPanel | FolderPanel>();
get('primary-editor').onpointerdown = () => { focusedPane = 'left'; };
get('secondary-editor').onpointerdown = () => { focusedPane = 'right'; };
let sessionList: SessionInfo[] = [];
const panels = new Layout(get);
const visibility = panels.visible;
const layout = () => panels.apply();
panels.menu(get('layout-menu'));
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
function syncEditor(path: string, from: EditorPanel) {
  const state = from.snapshot();
  const original = editors.get(path), other = secondary.get(path);
  if (original instanceof EditorPanel && original !== from) original.sync(state);
  if (other instanceof EditorPanel && other !== from) other.sync(state);
  renderEditors();
}
function ensureSecondary(path: string) {
  if (secondary.has(path)) return;
  const original = editors.get(path);
  if (!original) return;
  let panel: EditorPanel | FolderPanel;
  if (original instanceof FolderPanel) panel = new FolderPanel(original.path, (path) => void openFile(path), renderEditors, status);
  else { panel = new EditorPanel(original.snapshot().file, () => syncEditor(path, panel as EditorPanel), status); panel.sync(original.snapshot()); }
  secondary.set(path, panel); get('secondary-content').append(panel.element);
}
function renderEditors() {
  localStorage.setItem(workspaceKey('editor-tabs'), JSON.stringify([...editors].map(([path, panel]) => panel instanceof FolderPanel ? { folder: panel.path } : { file: path })));
  const active = editors.get(activeFile);
  localStorage.setItem(workspaceKey('active-file'), active instanceof FolderPanel ? 'folder:' + active.path : activeFile);
  localStorage.setItem(workspaceKey('secondary-file'), secondaryFile);
  localStorage.setItem(workspaceKey('editor-split'), String(splitOpen));
  get('secondary-editor').hidden = get('editor-divider').hidden = !splitOpen;
  get('primary-editor').style.flex = splitOpen ? String(splitRatio) : '1';
  get('secondary-editor').style.flex = String(1 - splitRatio);
  if (splitOpen && secondaryFile) ensureSecondary(secondaryFile);
  const close = (path: string) => {
    const editor = editors.get(path)!;
    if (editor.dirty && !confirm('Discard unsaved changes in ' + path + '?')) return;
    editor.element.remove(); secondary.get(path)?.element.remove(); secondary.delete(path); editors.delete(path);
    if (activeFile === path) activeFile = [...editors.keys()].at(-1) || '';
    if (secondaryFile === path) secondaryFile = [...editors.keys()].at(-1) || '';
    renderEditors();
  };
  for (const [side, container, current] of [['left', 'editor-tabs', activeFile], ['right', 'secondary-tabs', secondaryFile]] as const) {
    get(container).replaceChildren(...[...editors].map(([path, editor]) => {
      const view = side === 'left' ? editor : secondary.get(path);
      if (view) view.element.hidden = path !== current;
      const tab = document.createElement('div');
      tab.className = 'tab' + (editor instanceof FolderPanel ? ' folder-tab' : '') + (path === current ? ' active' : '');
      tab.oncontextmenu = (event) => menu(event, [
        ...(editor instanceof FolderPanel ? [{ label: 'Refresh folder', action: () => (view as FolderPanel || editor).refresh() }] : [
          { label: 'Save', hint: 'Ctrl/⌘+S', action: () => void (view as EditorPanel || editor).save() },
        ]),
        { label: 'Open in other pane', action: () => { splitOpen = true; if (side === 'left') secondaryFile = path; else activeFile = path; renderEditors(); } },
        { label: 'Close', action: () => close(path) },
      ]);
      tab.append(button((editor.dirty ? '● ' : '') + (editor instanceof FolderPanel ? editor.label : path.split('/').pop()), () => {
        focusedPane = side; if (side === 'left') activeFile = path; else secondaryFile = path; renderEditors();
      }, path), button('×', () => close(path), 'Close file'));
      return tab;
    }));
    const split = button('◫', () => { splitOpen = !splitOpen; if (splitOpen && !secondaryFile) secondaryFile = activeFile; if (!splitOpen) focusedPane = 'left'; renderEditors(); }, splitOpen ? 'Close the second editor' : 'Split the editor in two');
    split.className = 'editor-split-toggle'; split.setAttribute('aria-label', splitOpen ? 'Close the second editor' : 'Split the editor in two');
    get(container).append(split);
  }
}
const editorDivider = get('editor-divider');
editorDivider.onpointerdown = (event) => {
  event.preventDefault(); editorDivider.setPointerCapture(event.pointerId);
  const shield = document.createElement('div'); shield.className = 'resize-shield vertical'; document.body.append(shield);
  editorDivider.onpointermove = (move) => { const bounds = get('editor-panes').getBoundingClientRect(); splitRatio = Math.max(0.2, Math.min(0.8, (move.clientX - bounds.left) / bounds.width)); get('primary-editor').style.flex = String(splitRatio); get('secondary-editor').style.flex = String(1 - splitRatio); };
  const end = () => { shield.remove(); editorDivider.onpointermove = null; localStorage.setItem(workspaceKey('editor-ratio'), String(splitRatio)); };
  editorDivider.onpointerup = end; editorDivider.onpointercancel = end;
};
async function openFile(path: string) {
  try {
    if (!editors.has(path)) {
      const data = isImage(path) ? { path, content: '', revision: '' } : await api<FileContent>('/api/file?path=' + encodeURIComponent(path));
      const panel: EditorPanel = new EditorPanel(data, () => syncEditor(path, panel), status);
      editors.set(path, panel);
      get('editor-content').append(panel.element);
    }
    if (splitOpen && focusedPane === 'right') secondaryFile = path; else activeFile = path;
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
  if (splitOpen && focusedPane === 'right') secondaryFile = key; else activeFile = key;
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
    const savedSecondary = localStorage.getItem(workspaceKey('secondary-file'));
    const savedActive = localStorage.getItem(workspaceKey('active-file'));
    const savedVisibility = { ...visibility };
    for (const tab of Array.isArray(savedTabs) ? savedTabs : []) {
      if (typeof tab.folder === 'string') openFolder(tab.folder);
      else if (typeof tab.file === 'string') await openFile(tab.file);
    }
    if (savedActive && editors.has(savedActive)) { activeFile = savedActive; renderEditors(); }
    if (savedSecondary && editors.has(savedSecondary)) secondaryFile = savedSecondary;
    renderEditors();
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
void start().finally(startWindowSave);
