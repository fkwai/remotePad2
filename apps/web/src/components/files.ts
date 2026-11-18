import type { FileEntry, Navigation } from '@remotepad2/protocol';
import { api, button } from '../api';

interface Listing { path: string; parent: string; entries: FileEntry[] }
export class FilesIndex {
  readonly element = document.createElement('section');
  private path = document.createElement('input');
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
  constructor(private open: (path: string) => void, private report: (path: string) => void) {
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
    const form = document.createElement('form');
    this.path.setAttribute('aria-label', 'Directory');
    form.onsubmit = (event) => { event.preventDefault(); void this.load(this.path.value); };
    form.append(this.path);
    const actions = document.createElement('div');
    actions.className = 'index-modes';
    actions.append(button('★ Favorite', () => void this.pin('favorites'), 'Favorite current folder'),
      button('◆ Repo', () => void this.pin('repos'), 'Add current Git repo'));
    this.error.className = 'error';
    this.tree.className = 'file-tree';
    this.element.append(heading, modes, this.pins, form, actions, this.error, this.tree);
    void this.refreshPins();
    void this.load(localStorage.getItem('rp2.directory') || undefined);
  }
  private async refreshPins() {
    try { this.navigation = await api<Navigation>('/api/navigation'); this.renderPins(); }
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
      this.path.value = result.path;
      this.report(result.path);
      this.listings.set(result.path, result);
      this.expanded.add(result.path);
      this.error.textContent = '';
      this.renderTree();
    } catch (error) { this.error.textContent = (error as Error).message; }
  }
  private async toggle(directory: string) {
    try {
      if (this.expanded.has(directory)) this.expanded.delete(directory);
      else {
        this.listings.set(directory, await this.listing(directory));
        this.expanded.add(directory);
      }
      this.renderTree();
    } catch (error) { this.error.textContent = (error as Error).message; }
  }
  private renderTree() {
    this.tree.replaceChildren();
    const root = this.listings.get(this.root);
    if (!root) return;
    this.tree.append(button('..', () => void this.load(root.parent), 'Parent directory'));
    const heading = document.createElement('div');
    heading.className = 'tree-root';
    heading.textContent = this.root.split('/').pop() || '/';
    this.tree.append(heading);
    const append = (directory: string, depth: number) => {
      for (const item of this.listings.get(directory)?.entries || []) {
        const row = button((item.directory ? this.expanded.has(item.path) ? '▾ ' : '▸ ' : '  ') + item.name,
          () => {
            this.selected = item.path;
            if (item.directory) void this.toggle(item.path);
            else { this.open(item.path); this.renderTree(); }
          }, item.path);
        row.className = 'tree-row' + (this.selected === item.path ? ' selected' : '');
        row.style.paddingLeft = (8 + depth * 14) + 'px';
        if (item.directory) row.setAttribute('aria-expanded', String(this.expanded.has(item.path)));
        this.tree.append(row);
        if (item.directory && this.expanded.has(item.path)) append(item.path, depth + 1);
      }
    };
    append(this.root, 0);
  }
}
