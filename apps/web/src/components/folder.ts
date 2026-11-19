import type { FileEntry } from '@remotepad2/protocol';
import { api, button } from '../api';
import { menu } from './menu';

export class FolderPanel {
  readonly element = document.createElement('section');
  readonly dirty = false;
  label = '';
  private current: string;
  private listing = document.createElement('div');
  private address = document.createElement('input');
  private details = false;
  private selected = new Set<string>();
  private anchor = -1;
  private entries: FileEntry[] = [];
  private generation = 0;
  get path() { return this.current; }
  refresh() { void this.load(this.current); }
  constructor(directory: string, private open: (path: string) => void, private changed: () => void,
    private status: (text: string) => void) {
    this.current = directory;
    this.label = (directory.split('/').pop() || '/') + '/';
    this.element.className = 'folder-body';
    this.element.setAttribute('aria-label', 'Folder explorer');
    const toolbar = document.createElement('form'); toolbar.className = 'folder-toolbar';
    this.address.setAttribute('aria-label', 'Explorer directory');
    toolbar.onsubmit = (event) => { event.preventDefault(); void this.load(this.address.value); };
    const icons = button('▦', () => { this.details = false; this.updateMode(); }, 'Icons'); icons.setAttribute('aria-label', 'Icons');
    const details = button('☷', () => { this.details = true; this.updateMode(); }, 'Details'); details.setAttribute('aria-label', 'Details');
    const up = button('↑', () => void this.load(this.current.split('/').slice(0, -1).join('/') || '/'), 'Parent directory');
    const refresh = button('↻', () => this.refresh(), 'Refresh folder');
    toolbar.append(up, this.address, icons, details, refresh);
    for (const control of [up, icons, details, refresh]) control.type = 'button';
    this.listing.className = 'folder-items';
    this.listing.onclick = (event) => { if (event.target === this.listing) { this.selected.clear(); this.updateSelection(); } };
    this.listing.oncontextmenu = (event) => {
      if (event.target === this.listing) menu(event, [
        { label: 'Refresh', action: () => this.refresh() },
        { label: 'Add folder to Favorites', action: () => void this.pin('favorites', this.current) },
        { label: 'Add folder to Repos', action: () => void this.pin('repos', this.current) },
      ]);
    };
    this.element.append(toolbar, this.listing);
    void this.load(directory);
  }
  private async pin(kind: 'favorites' | 'repos', path: string) {
    try {
      await api('/api/navigation', { method: 'POST', body: JSON.stringify({ kind, path }) });
      window.dispatchEvent(new Event('navigation-changed'));
    } catch (error) { this.status((error as Error).message); }
  }
  private updateMode() {
    this.listing.classList.toggle('details', this.details);
    this.element.querySelector('[aria-label="Icons"]')?.setAttribute('aria-pressed', String(!this.details));
    this.element.querySelector('[aria-label="Details"]')?.setAttribute('aria-pressed', String(this.details));
  }
  private updateSelection() {
    for (const row of Array.from(this.listing.querySelectorAll<HTMLElement>('.folder-item'))) {
      const selected = this.selected.has(row.dataset.path || ''); row.classList.toggle('selected', selected); row.setAttribute('aria-selected', String(selected));
    }
  }
  private async load(directory: string) {
    const generation = ++this.generation;
    try {
      const result = await api<{ path: string; entries: FileEntry[] }>('/api/files?details=1&path=' + encodeURIComponent(directory));
      if (generation !== this.generation) return;
      this.current = result.path;
      this.address.value = result.path;
      this.label = (result.path.split('/').pop() || '/') + '/';
      this.entries = result.entries; this.selected.clear(); this.anchor = -1;
      this.changed();
      this.listing.replaceChildren();
      const heading = document.createElement('div'); heading.className = 'folder-detail-heading';
      for (const name of ['Name', 'Size', 'Modified']) { const span = document.createElement('span'); span.textContent = name; heading.append(span); }
      this.listing.append(heading);
      for (const [index, entry] of this.entries.entries()) {
        const row = button('', () => {}, entry.path);
        row.className = 'folder-item'; row.dataset.path = entry.path;
        row.onclick = (event) => {
          if (event.shiftKey && this.anchor >= 0) {
            if (!event.ctrlKey && !event.metaKey) this.selected.clear();
            for (let n = Math.min(this.anchor, index); n <= Math.max(this.anchor, index); n++) this.selected.add(this.entries[n].path);
          } else if (event.ctrlKey || event.metaKey) {
            if (this.selected.has(entry.path)) this.selected.delete(entry.path); else this.selected.add(entry.path);
            this.anchor = index;
          } else { this.selected = new Set([entry.path]); this.anchor = index; }
          this.updateSelection();
        };
        const icon = document.createElement('span'); icon.className = 'folder-icon'; icon.textContent = entry.directory ? '▣' : '▤';
        const name = document.createElement('span'); name.className = 'folder-name'; name.textContent = entry.name;
        const size = document.createElement('span'); size.className = 'folder-size'; size.textContent = entry.directory || entry.size == null ? '—' : entry.size < 1024 ? entry.size + ' B' : (entry.size / 1024).toFixed(1) + ' KB';
        const modified = document.createElement('span'); modified.className = 'folder-modified'; modified.textContent = entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString() : '—';
        row.append(icon, name, size, modified);
        const open = () => entry.directory ? void this.load(entry.path) : this.open(entry.path);
        row.ondblclick = open;
        row.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); open(); } };
        row.oncontextmenu = (event) => {
          if (!this.selected.has(entry.path)) { this.selected = new Set([entry.path]); this.updateSelection(); }
          menu(event, [
            { label: 'Open', hint: 'Dbl-click / Enter', action: open },
            ...(entry.directory ? [
              { label: 'Add to Favorites', action: () => void this.pin('favorites', entry.path) },
              { label: 'Add to Repos', action: () => void this.pin('repos', entry.path) },
            ] : []),
            { label: 'Refresh', action: () => this.refresh() },
          ]);
        };
        this.listing.append(row);
      }
      this.updateMode();
    } catch (error) { this.status((error as Error).message); }
  }
}
