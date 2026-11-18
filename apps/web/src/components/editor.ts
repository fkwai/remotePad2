import { marked } from 'marked';
import type { FileContent } from '@remotepad2/protocol';
import { api, button } from '../api';

export class EditorPanel {
  readonly element = document.createElement('section');
  private text = document.createElement('textarea');
  private preview = document.createElement('iframe');
  private rendered = false;
  dirty = false;
  constructor(private file: FileContent, private changed: () => void, private status: (message: string) => void) {
    this.element.className = 'editor-body';
    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    const canRender = /\.(md|markdown|html?)$/i.test(file.path);
    this.preview.title = 'Rendered file';
    this.preview.setAttribute('sandbox', '');
    this.preview.hidden = true;
    this.text.spellcheck = false;
    this.text.setAttribute('aria-label', 'File content');
    this.text.value = file.content;
    this.text.oninput = () => { this.dirty = this.text.value !== this.file.content; changed(); };
    const save = button('Save', () => void this.save(), 'Ctrl/⌘+S');
    toolbar.append(save);
    if (canRender) toolbar.append(button('Source / Render', () => {
      this.rendered = !this.rendered;
      this.text.hidden = this.rendered;
      this.preview.hidden = !this.rendered;
      if (this.rendered) this.preview.srcdoc = /\.html?$/i.test(file.path)
        ? this.text.value
        : '<style>body{font:16px system-ui;line-height:1.6;padding:16px;overflow-wrap:anywhere}pre{white-space:pre-wrap}</style>' + marked.parse(this.text.value, { async: false });
    }));
    this.text.onkeydown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void this.save(); }
      if (event.key === 'Tab') {
        event.preventDefault();
        this.text.setRangeText('  ', this.text.selectionStart, this.text.selectionEnd, 'end');
        this.text.dispatchEvent(new Event('input'));
      }
    };
    this.element.append(toolbar, this.text, this.preview);
  }
  private saving = false;
  async save() {
    if (this.saving) return;
    this.saving = true;
    const content = this.text.value;
    try {
      this.file = await api<FileContent>('/api/file', { method: 'PUT', body: JSON.stringify({ ...this.file, content }) });
      this.dirty = this.text.value !== this.file.content;
      this.changed();
      this.status('Saved ' + this.file.path);
    } catch (error) { this.status((error as Error).message); }
    finally { this.saving = false; }
  }
}
