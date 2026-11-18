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
  private selected = '';
  private generation = 0;
  constructor(directory: string, private open: (path: string) => void, private changed: () => void,
    private status: (text: string) => void) {
    this.current = directory;
    this.label = (directory.split('/').pop() || '/') + '/';
    this.element.className = 'folder-body';
    this.element.setAttribute('aria-label', 'Folder explorer');
    const toolbar = document.createElement('form');
    toolbar.className = 'folder-toolbar';
    this.address.setAttribute('aria-label', 'Explorer directory');
    toolbar.onsubmit = (event) => { event.preventDefault(); void this.load(this.address.value); };
    const icons = button('Icons', () => { this.details = false; this.updateMode(); });
    const details = button('Details', () => { this.details = true; this.updateMode(); });
    toolbar.append(button('↑', () => void this.load(this.current.split('/').slice(0, -1).join('/') || '/'), 'Parent directory'),
      this.address, icons, details, button('↻', () => void this.load(this.current), 'Refresh folder'));
    for (const node of [icons, details, toolbar.lastElementChild as HTMLButtonElement]) node.type = 'button';
    (toolbar.firstElementChild as HTMLButtonElement).type = 'button';
    this.listing.className = 'folder-items';
    this.listing.onclick = (event) => { if (event.target === this.listing) { this.selected = ''; this.updateSelection(); } };
    this.listing.oncontextmenu = (event) => {
      if (event.target === this.listing) menu(event, [{ label: 'Refresh', action: () => void this.load(this.current) }]);
    };
    this.element.append(toolbar, this.listing);
    void this.load(directory);
  }
  private updateMode() { this.listing.classList.toggle('details', this.details); }
  private updateSelection() {
    for (const row of Array.from(this.listing.children)) row.classList.toggle('selected', (row as HTMLElement).dataset.path === this.selected);
  }
  private async load(directory: string) {
    const generation = ++this.generation;
    try {
      const result = await api<{ path: string; entries: FileEntry[] }>('/api/files?path=' + encodeURIComponent(directory));
      if (generation !== this.generation) return;
      this.current = result.path;
      this.address.value = result.path;
      this.label = (result.path.split('/').pop() || '/') + '/';
      this.changed();
      this.listing.replaceChildren(...result.entries.map((entry) => {
        const row = button('', () => { this.selected = entry.path; this.updateSelection(); }, entry.path);
        row.className = 'folder-item';
        row.dataset.path = entry.path;
        const icon = document.createElement('span');
        icon.className = 'folder-icon';
        icon.textContent = entry.directory ? '▣' : '▤';
        const name = document.createElement('span');
        name.textContent = entry.name;
        row.append(icon, name);
        const open = () => entry.directory ? void this.load(entry.path) : this.open(entry.path);
        row.ondblclick = open;
        row.oncontextmenu = (event) => menu(event, [
          { label: 'Open', hint: 'Dbl-click', action: open },
          { label: 'Refresh', action: () => void this.load(this.current) },
        ]);
        return row;
      }));
      this.updateMode();
    } catch (error) { this.status((error as Error).message); }
  }
}
