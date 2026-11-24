import type { FileEntry, Navigation } from '@remotepad2/protocol';
import { iconControl } from './icons';
import { popover } from './popover';
import { workspaceKey } from '../connection';
import { menu } from './menu';
import { api, button } from '../api';

interface Listing { path: string; parent: string; entries: FileEntry[] }
export class FilesIndex {
  readonly element = document.createElement('section');
  private showHidden = localStorage.getItem(workspaceKey('show-hidden')) === 'true';
  private tree = document.createElement('div');
  private pins = { favorites: document.createElement('section'), repos: document.createElement('section') };
  private sections = { search: true, favorites: true, repos: true };
  private searchPanel = document.createElement('section');
  private searchInput = document.createElement('input');
  private searchResults = document.createElement('div');
  private searchTimer?: number;
  private searchAbort?: AbortController;
  private branches = new Map<string, { element: HTMLDivElement; children: HTMLDivElement }>();
  private error = document.createElement('div');
  private root = '';
  private selected = '';
  private expanded = new Set<string>();
  private listings = new Map<string, Listing>();
  private loads = new Map<string, Promise<Listing>>();
  private navigation: Navigation = { favorites: [], repos: [] };
  private generation = 0;
  private rows = new Map<string, HTMLDivElement>();
  constructor(private open: (path: string) => void, private report: (path: string) => void, private openFolder: (path: string) => void) {
    this.element.className = 'index files-index';
    this.element.setAttribute('aria-label', 'Files Index');
    const heading = document.createElement('h2');
    heading.textContent = 'Files Index';
    try {
      const saved = JSON.parse(localStorage.getItem(workspaceKey('sidebar-panels')) || '{}');
      for (const name of ['search', 'favorites', 'repos'] as const) if (typeof saved[name] === 'boolean') this.sections[name] = saved[name];
    } catch {}
    const actions = document.createElement('div'); actions.className = 'file-actions'; actions.setAttribute('role', 'toolbar'); actions.setAttribute('aria-label', 'Files tools');
    for (const [name, label, icon] of [['search', 'Search', 'search'], ['favorites', 'Favorites', 'favorite'], ['repos', 'Repos', 'repo']] as const) {
      const control = iconControl(button('', () => {
        this.sections[name] = !this.sections[name]; control.setAttribute('aria-pressed', String(this.sections[name]));
        this.updateSections(); if (name === 'search') { this.search(); if (this.sections.search) this.searchInput.focus(); }
      }), label, icon);
      control.setAttribute('aria-pressed', String(this.sections[name])); actions.append(control);
    }
    const spacer = document.createElement('span'); spacer.className = 'file-tools-spacer'; actions.append(spacer);
    actions.append(iconControl(button('', () => void this.load(this.root)), 'Refresh tree', 'refresh'));
    const address = document.createElement('div'); actions.append(address);
    const addressButton = popover(address, 'Go to path', (body, close) => {
      const form = document.createElement('form');
      const input = document.createElement('input'); input.setAttribute('aria-label', 'Directory'); input.value = this.root;
      const submit = button('Go', () => {}); submit.type = 'submit';
      form.onsubmit = (event) => { event.preventDefault(); void this.load(input.value).then((loaded) => { if (loaded) { this.openFolder(this.root); close(); } }); };
      form.append(input, submit); body.append(form); input.focus(); input.select();
    });
    iconControl(addressButton, 'Go to path', 'folder');
    const hidden = iconControl(button('', () => {
      this.showHidden = !this.showHidden; hidden.setAttribute('aria-pressed', String(this.showHidden));
      localStorage.setItem(workspaceKey('show-hidden'), String(this.showHidden)); this.renderTree(); this.search();
      window.dispatchEvent(new Event('hidden-files-changed'));
    }), 'Show hidden files', 'hidden');
    hidden.setAttribute('aria-label', 'Show hidden files'); hidden.setAttribute('aria-pressed', String(this.showHidden));
    actions.append(hidden);
    this.tree.oncontextmenu = (event) => {
      if (event.target === this.tree) menu(event, [{ label: 'Open folder in Explorer', action: () => this.openFolder(this.root) }, { label: 'Refresh', action: () => void this.load(this.root) }]);
    };
    this.error.className = 'error';
    this.tree.className = 'file-tree';
    const panels = document.createElement('div'); panels.className = 'file-tool-panels';
    this.searchPanel.className = 'file-search'; this.searchPanel.setAttribute('aria-label', 'Search panel');
    this.searchInput.type = 'search'; this.searchInput.setAttribute('aria-label', 'Search files'); this.searchInput.placeholder = 'Find files and folders…';
    this.searchInput.oninput = () => this.search();
    this.searchResults.className = 'file-search-results'; this.searchResults.setAttribute('aria-live', 'polite');
    this.searchPanel.append(this.searchInput, this.searchResults); panels.append(this.searchPanel);
    for (const kind of ['favorites', 'repos'] as const) {
      this.pins[kind].className = 'pin-section'; this.pins[kind].setAttribute('aria-label', kind === 'favorites' ? 'Favorites panel' : 'Repos panel'); panels.append(this.pins[kind]);
    }
    this.element.append(heading, actions, panels, this.error, this.tree);
    this.updateSections();
    window.addEventListener('navigation-changed', () => void this.refreshPins());
    void this.refreshPins();
    void this.load(localStorage.getItem(workspaceKey('directory')) || undefined);
  }
  private async refreshPins() {
    try { this.navigation = await api<Navigation>('/api/navigation'); this.renderPins(); this.renderTree(); }
    catch (error) { this.error.textContent = (error as Error).message; }
  }
  private updateSections() {
    this.searchPanel.hidden = !this.sections.search;
    for (const kind of ['favorites', 'repos'] as const) this.pins[kind].hidden = !this.sections[kind];
    localStorage.setItem(workspaceKey('sidebar-panels'), JSON.stringify(this.sections));
  }
  private search() {
    clearTimeout(this.searchTimer); this.searchAbort?.abort();
    const query = this.searchInput.value.trim();
    if (!this.sections.search || !query || !this.root) { this.searchResults.replaceChildren(); return; }
    this.searchResults.textContent = 'Searching…';
    const abort = new AbortController(); this.searchAbort = abort;
    this.searchTimer = window.setTimeout(async () => {
      try {
        const result = await api<{hits: FileEntry[]; truncated: boolean}>('/api/search?path=' + encodeURIComponent(this.root) + '&q=' + encodeURIComponent(query) + '&hidden=' + this.showHidden, {signal:abort.signal});
        if (abort.signal.aborted) return;
        this.searchResults.replaceChildren(...result.hits.map((entry) => {
          const row = button('', () => entry.directory ? this.openFolder(entry.path) : this.open(entry.path), entry.path);
          row.className = 'file-search-hit'; const name = document.createElement('span'); name.textContent = entry.name;
          const detail = document.createElement('small'); detail.textContent = entry.path.slice(this.root.length + 1); row.append(name, detail);
          row.oncontextmenu = (event) => menu(event, [{label: entry.directory ? 'Open in Explorer' : 'Open', action: () => entry.directory ? this.openFolder(entry.path) : this.open(entry.path)}]);
          return row;
        }));
        if (!result.hits.length || result.truncated) { const note = document.createElement('small'); note.textContent = result.truncated ? 'Showing limited results — narrow your search.' : 'No matching files'; this.searchResults.append(note); }
      } catch (error) { if (!abort.signal.aborted) this.searchResults.textContent = (error as Error).message; }
    }, 180);
  }
  private renderPins() {
    for (const kind of ['favorites', 'repos'] as const) {
      const panel = this.pins[kind]; panel.replaceChildren();
      const heading = document.createElement('h3'); heading.textContent = kind === 'favorites' ? 'Favorites' : 'Repos'; panel.append(heading);
      for (const item of this.navigation[kind]) {
        const row = document.createElement('div'); row.className = 'pin-row';
        const open = button(item.name + (item.branch ? ' · ' + item.branch : ''), () => void this.load(item.path), item.path);
        open.oncontextmenu = (event) => menu(event, [
          {label:'Open in Explorer',action:()=>this.openFolder(item.path)},
          {label:'Browse as root',action:()=>void this.load(item.path)},
          {label: kind === 'favorites' ? 'Remove from Favorites' : 'Remove from Repos',action:()=>void this.pin(kind,item.path,true)},
        ]);
        row.append(open, button('×', () => void this.pin(kind, item.path, true), 'Remove ' + item.name)); panel.append(row);
      }
      if (!this.navigation[kind].length) { const empty = document.createElement('small'); empty.className = 'pins-empty'; empty.textContent = kind === 'favorites' ? 'No favorites yet' : 'No repos yet'; panel.append(empty); }
    }
  }
  private async pin(kind: 'favorites' | 'repos', target = this.root, remove = false) {
    try {
      await api('/api/navigation', { method: 'POST', body: JSON.stringify({ kind, path: target, remove }) });
      await this.refreshPins();
    } catch (error) { this.error.textContent = (error as Error).message; }
  }
  private listing(directory?: string) {
    const key = directory || '';
    let task = this.loads.get(key);
    if (!task) {
      task = api<Listing>('/api/files' + (directory ? '?path=' + encodeURIComponent(directory) : '')).finally(() => this.loads.delete(key));
      this.loads.set(key, task);
    }
    return task;
  }
  private async load(directory?: string) {
    const generation = ++this.generation;
    try {
      const result = await this.listing(directory);
      if (generation !== this.generation) return;
      this.root = result.path;
      this.report(result.path);
      this.listings.set(result.path, result);
      this.expanded.add(result.path);
      this.error.textContent = '';
      this.renderTree(); this.search();
      return true;
    } catch (error) { this.error.textContent = (error as Error).message; }
  }
  private async toggle(directory: string, ensureOpen = false) {
    const open = ensureOpen || !this.expanded.has(directory);
    if (open) this.expanded.add(directory); else this.expanded.delete(directory);
    this.renderTree();
    if (!open) return;
    try {
      this.listings.set(directory, await this.listing(directory));
      this.renderTree();
    } catch (error) { this.error.textContent = (error as Error).message; }
  }
  private renderTree() {
    const root = this.listings.get(this.root);
    if (!root) return;
    const nodes: HTMLElement[] = [];
    let parent = this.tree.querySelector<HTMLButtonElement>(':scope > .tree-parent');
    if (!parent) { parent = button('…', () => void this.load(this.listings.get(this.root)?.parent), 'Parent directory'); parent.className = 'tree-parent'; }
    const upHeight = root.parent === root.path ? 0 : 28;
    if (upHeight) nodes.push(parent);
    const pinned = new Set(this.navigation.favorites.map((item) => item.path));
    const repos = new Set(this.navigation.repos.map((item) => item.path));
    const append = (item: FileEntry, depth: number) => {
      let row = this.rows.get(item.path);
      if (!row) { row = document.createElement('div'); row.tabIndex = 0; this.rows.set(item.path, row); }
      row.className = 'tree-row' + (item.directory && this.expanded.has(item.path) ? ' frozen-root' : '') + (this.selected === item.path ? ' selected' : '');
      row.dataset.path = item.path;
      row.title = item.path;
      row.style.paddingLeft = (4 + depth * 14) + 'px';
      row.style.top = (upHeight + depth * 28) + 'px';
      row.style.zIndex = String(100 - depth);
      row.dataset.depth = String(depth);
      row.onclick = (event) => {
        this.selected = item.path;
        if (item.directory) {
          if (event.detail === 2) { void this.toggle(item.path, true); this.openFolder(item.path); }
          else void this.toggle(item.path);
        } else { this.open(item.path); this.renderTree(); }
      };
      row.onkeydown = (event) => { if (event.target === row && event.key === 'Enter') { event.preventDefault(); item.directory ? this.openFolder(item.path) : this.open(item.path); } };
      row.oncontextmenu = (event) => { this.selected = item.path; this.renderTree(); menu(event, [
        { label: item.directory ? 'Open in Explorer' : 'Open', hint: item.directory ? 'Dbl-click / Enter' : 'Enter', action: () => item.directory ? this.openFolder(item.path) : this.open(item.path) },
        ...(item.directory ? [
          { label: 'Browse as root', action: () => void this.load(item.path) },
          { label: pinned.has(item.path) ? 'Remove from Favorites' : 'Add to Favorites', action: () => void this.pin('favorites', item.path, pinned.has(item.path)) },
          { label: repos.has(item.path) ? 'Remove from Repos' : 'Add to Repos', action: () => void this.pin('repos', item.path, repos.has(item.path)) },
        ] : []),
        { label: 'Refresh', action: () => void this.load(this.root) },
      ]); };
      // Keep both the row and name nodes mounted across expansion and pin updates.
      // Replacing them between clicks breaks native double-click counting.
      let chevron = row.querySelector<HTMLButtonElement>('.tree-chevron');
      let name = row.querySelector<HTMLElement>('.tree-name');
      if (!name) {
        chevron = iconControl(button('', () => {}), item.directory ? 'Expand or collapse folder' : 'File', item.directory ? 'chevron' : 'file'); chevron.classList.add('tree-chevron');
        name = document.createElement('span'); name.className = 'tree-name';
        row.append(chevron, name);
      }
      if (name.textContent !== item.name) name.textContent = item.name;
      chevron!.classList.toggle('expanded', item.directory && this.expanded.has(item.path));
      chevron!.disabled = !item.directory;
      chevron!.title = 'Expand or collapse folder';
      chevron!.onclick = (event) => { event.stopPropagation(); this.selected = item.path; if (event.detail !== 2) void this.toggle(item.path); };
      if (item.directory) row.setAttribute('aria-expanded', String(this.expanded.has(item.path)));
      for (const [kind, label, on] of [
        ['repos', 'Repo', repos.has(item.path)], ['favorites', 'Favorite', pinned.has(item.path)],
      ] as const) {
        if (!item.directory) continue;
        let control = row.querySelector<HTMLButtonElement>('.pin-' + kind);
        if (!control) { control = iconControl(button('', () => {}), label, kind === 'favorites' ? 'favorite' : 'repo'); control.classList.add('tree-pin', 'pin-' + kind); row.append(control); }
        control.classList.toggle('on', on);
        control.title = (on ? 'Remove from ' : 'Add to ') + label;
        control.setAttribute('aria-label', control.title + ': ' + item.name);
        control.setAttribute('aria-pressed', String(on));
        control.onclick = (event) => { event.stopPropagation(); void this.pin(kind, item.path, on); };
      }
      if (!item.directory) return row;
      let branch = this.branches.get(item.path);
      if (!branch) {
        const element = document.createElement('div'), children = document.createElement('div');
        element.className = 'tree-branch'; children.className = 'tree-children'; element.append(row, children);
        branch = { element, children }; this.branches.set(item.path, branch);
      }
      branch.children.hidden = !this.expanded.has(item.path);
      const children: HTMLElement[] = [];
      if (this.expanded.has(item.path)) for (const child of this.listings.get(item.path)?.entries || []) {
        if (this.showHidden || !child.name.startsWith('.')) children.push(append(child, depth + 1));
      }
      reconcile(branch.children, children);
      return branch.element;
    };
    nodes.push(append({ name: this.root.split('/').pop() || '/', path: this.root, directory: true }, 0));
    reconcile(this.tree, nodes);
  }
}

function reconcile(parent: HTMLElement, nodes: HTMLElement[]) {
  const keep = new Set(nodes);
  for (const child of Array.from(parent.children)) if (!keep.has(child as HTMLElement)) child.remove();
  nodes.forEach((node, index) => { if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] || null); });
}
