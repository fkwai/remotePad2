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
  private pins = document.createElement('div');
  private error = document.createElement('div');
  private root = '';
  private selected = '';
  private expanded = new Set<string>();
  private listings = new Map<string, Listing>();
  private mode: 'favorites' | 'repos' = 'favorites';
  private navigation: Navigation = { favorites: [], repos: [] };
  private generation = 0;
  private rows = new Map<string, HTMLDivElement>();
  constructor(private open: (path: string) => void, private report: (path: string) => void, private openFolder: (path: string) => void) {
    this.element.className = 'index files-index';
    this.element.setAttribute('aria-label', 'Files Index');
    const heading = document.createElement('h2');
    heading.textContent = 'Files Index';
    const modes = document.createElement('div');
    modes.className = 'index-modes';
    for (const kind of ['favorites', 'repos'] as const) {
      const control = button(kind === 'favorites' ? 'Favorites' : 'Repos', () => {
        this.mode = kind; this.renderPins();
        for (const node of Array.from(modes.children)) node.setAttribute('aria-pressed', String(node === control));
      });
      control.setAttribute('aria-pressed', String(this.mode === kind));
      modes.append(control);
    }
    const actions = document.createElement('div'); actions.className = 'file-actions';
    actions.append(iconControl(button('', () => void this.load(this.root)), 'Refresh tree', 'refresh'));
    const address = document.createElement('div'); actions.append(address);
    const addressButton = popover(address, 'Go to path', (body, close) => {
      const form = document.createElement('form');
      const input = document.createElement('input'); input.setAttribute('aria-label', 'Directory'); input.value = this.root;
      const submit = button('Go', () => {}); submit.type = 'submit';
      form.onsubmit = (event) => { event.preventDefault(); void this.load(input.value).then((loaded) => { if (loaded) { this.openFolder(this.root); close(); } }); };
      form.append(input, submit); body.append(form); input.focus(); input.select();
    });
    addressButton.textContent = '⌁'; addressButton.setAttribute('aria-label', 'Go to path'); addressButton.title = 'Go to path';
    const hidden = button('.*', () => {
      this.showHidden = !this.showHidden; hidden.setAttribute('aria-pressed', String(this.showHidden));
      localStorage.setItem(workspaceKey('show-hidden'), String(this.showHidden)); this.renderTree();
      window.dispatchEvent(new Event('hidden-files-changed'));
    }, 'Show hidden files');
    hidden.setAttribute('aria-label', 'Show hidden files'); hidden.setAttribute('aria-pressed', String(this.showHidden));
    actions.append(hidden);
    this.tree.oncontextmenu = (event) => {
      if (event.target === this.tree) menu(event, [{ label: 'Open folder in Explorer', action: () => this.openFolder(this.root) }, { label: 'Refresh', action: () => void this.load(this.root) }]);
    };
    this.error.className = 'error';
    this.tree.className = 'file-tree';
    this.element.append(heading, modes, this.pins, actions, this.error, this.tree);
    window.addEventListener('navigation-changed', () => void this.refreshPins());
    void this.refreshPins();
    void this.load(localStorage.getItem(workspaceKey('directory')) || undefined);
  }
  private async refreshPins() {
    try { this.navigation = await api<Navigation>('/api/navigation'); this.renderPins(); this.renderTree(); }
    catch (error) { this.error.textContent = (error as Error).message; }
  }
  private renderPins() {
    this.pins.replaceChildren();
    for (const item of this.navigation[this.mode]) {
      const row = document.createElement('div');
      row.className = 'pin-row';
      row.append(button((this.mode === 'favorites' ? '★ ' : '◆ ') + item.name + (item.branch ? ' · ' + item.branch : ''),
        () => void this.load(item.path), item.path),
      button('×', () => void this.pin(this.mode, item.path, true), 'Remove ' + item.name));
      this.pins.append(row);
    }
    if (!this.navigation[this.mode].length) this.pins.textContent = this.mode === 'favorites' ? 'No favorites yet' : 'No repos yet';
  }
  private async pin(kind: 'favorites' | 'repos', target = this.root, remove = false) {
    try {
      await api('/api/navigation', { method: 'POST', body: JSON.stringify({ kind, path: target, remove }) });
      await this.refreshPins();
    } catch (error) { this.error.textContent = (error as Error).message; }
  }
  private async listing(directory?: string) {
    return api<Listing>('/api/files' + (directory ? '?path=' + encodeURIComponent(directory) : ''));
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
      this.renderTree();
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
    nodes.push(parent);
    const pinned = new Set(this.navigation.favorites.map((item) => item.path));
    const repos = new Set(this.navigation.repos.map((item) => item.path));
    const append = (item: FileEntry, depth: number) => {
      let row = this.rows.get(item.path);
      if (!row) { row = document.createElement('div'); row.tabIndex = 0; this.rows.set(item.path, row); }
      row.className = 'tree-row' + (item.directory && (depth === 0 || this.selected.startsWith(item.path + '/')) ? ' frozen-root' : '') + (this.selected === item.path ? ' selected' : '');
      row.dataset.path = item.path;
      row.title = item.path;
      row.style.paddingLeft = (4 + depth * 14) + 'px';
      row.style.top = (28 + depth * 28) + 'px';
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
        chevron = button('', () => {}); chevron.className = 'tree-chevron';
        name = document.createElement('span'); name.className = 'tree-name';
        row.append(chevron, name);
      }
      name.textContent = item.name;
      chevron!.textContent = item.directory ? (this.expanded.has(item.path) ? '▾' : '▸') : '·';
      chevron!.disabled = !item.directory;
      chevron!.title = 'Expand or collapse folder';
      chevron!.onclick = (event) => { event.stopPropagation(); this.selected = item.path; if (event.detail !== 2) void this.toggle(item.path); };
      if (item.directory) row.setAttribute('aria-expanded', String(this.expanded.has(item.path)));
      for (const [kind, label, symbol, on] of [
        ['repos', 'Repo', '◆', repos.has(item.path)], ['favorites', 'Favorite', '★', pinned.has(item.path)],
      ] as const) {
        if (!item.directory) continue;
        let control = row.querySelector<HTMLButtonElement>('.pin-' + kind);
        if (!control) { control = button(symbol, () => {}); control.className = 'tree-pin pin-' + kind; row.append(control); }
        control.classList.toggle('on', on);
        control.title = (on ? 'Remove from ' : 'Add to ') + label;
        control.setAttribute('aria-label', control.title + ': ' + item.name);
        control.setAttribute('aria-pressed', String(on));
        control.onclick = (event) => { event.stopPropagation(); void this.pin(kind, item.path, on); };
      }
      nodes.push(row);
      if (item.directory && this.expanded.has(item.path)) for (const child of this.listings.get(item.path)?.entries || []) { if (this.showHidden || !child.name.startsWith('.')) append(child, depth + 1); }
    };
    append({ name: this.root.split('/').pop() || '/', path: this.root, directory: true }, 0);
    // Reconcile without detaching retained rows (including pointer targets).
    const keep = new Set(nodes);
    for (const child of Array.from(this.tree.children)) if (!keep.has(child as HTMLElement)) child.remove();
    nodes.forEach((node, index) => { if (this.tree.children[index] !== node) this.tree.insertBefore(node, this.tree.children[index] || null); });
  }
}
