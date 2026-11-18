import type { FileEntry } from '@remotepad2/protocol';
import { api, button } from '../api';

export class FilesIndex {
  readonly element = document.createElement('section');
  private path = document.createElement('input');
  private entries = document.createElement('div');
  private error = document.createElement('div');
  private generation = 0;
  constructor(open: (path: string) => void, report: (path: string) => void) {
    this.element.className = 'index';
    this.element.setAttribute('aria-label', 'Files Index');
    const form = document.createElement('form');
    this.path.setAttribute('aria-label', 'Directory');
    const load = async (directory?: string) => {
      const generation = ++this.generation;
      try {
        const data = await api<{ path: string; parent: string; entries: FileEntry[] }>(
          '/api/files' + (directory ? '?path=' + encodeURIComponent(directory) : ''));
        if (generation !== this.generation) return;
        this.error.textContent = '';
        this.path.value = data.path;
        report(data.path);
        const up = button('..', () => void load(data.parent), 'Parent directory');
        this.entries.replaceChildren(up);
        for (const entry of data.entries) {
          const row = button((entry.directory ? '▸ ' : '') + entry.name,
            () => { if (entry.directory) void load(entry.path); else open(entry.path); }, entry.path);
          row.className = 'file-row';
          this.entries.append(row);
        }
      } catch (error) { if (generation === this.generation) this.error.textContent = (error as Error).message; }
    };
    form.onsubmit = (e) => { e.preventDefault(); void load(this.path.value); };
    form.append(this.path);
    this.error.className = 'error';
    const heading = document.createElement('h2');
    heading.textContent = 'Files Index';
    this.element.append(heading, form, this.error, this.entries);
    void load(localStorage.getItem('rp2.directory') || undefined);
  }
}
