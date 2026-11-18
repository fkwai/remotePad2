import { marked } from 'marked';
import type { FileContent } from '@remotepad2/protocol';
import { api, button } from '../api';
import { menu } from './menu';
import { isImage, jsonTree, previewUrl, table } from './render';

export class EditorPanel {
  readonly element = document.createElement('section');
  private text = document.createElement('textarea');
  private preview = document.createElement('div');
  private rendered = false;
  private mode?: HTMLButtonElement;
  private scale = 1;
  private saving = false;
  dirty = false;
  constructor(private file: FileContent, private changed: () => void, private status: (message: string) => void) {
    this.element.className = 'editor-body';
    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    const image = isImage(file.path);
    const canRender = image || /\.(md|markdown|html?|json|jsonl|ndjson|csv|tsv|log)$/i.test(file.path);
    this.preview.className = 'rendered-view';
    this.preview.setAttribute('aria-label', 'Rendered file');
    this.preview.hidden = true;
    this.text.spellcheck = false;
    this.text.setAttribute('aria-label', 'File content');
    this.text.value = file.content;
    this.text.oninput = () => { this.dirty = this.text.value !== this.file.content; changed(); };
    if (!image) toolbar.append(button('Save', () => void this.save(), 'Ctrl/⌘+S'));
    if (canRender && !image) {
      this.mode = button('Source / Render', () => this.toggle(), 'Ctrl/⌘+L');
      toolbar.append(this.mode);
    }
    if (image) {
      toolbar.append(button('−', () => this.zoom(-0.1), 'Zoom out'),
        button('100%', () => { this.scale = 1; this.zoom(0); }, 'Reset zoom'),
        button('+', () => this.zoom(0.1), 'Zoom in'));
    }
    this.element.tabIndex = -1;
    this.element.onkeydown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !image) { event.preventDefault(); void this.save(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l' && canRender && !image) { event.preventDefault(); this.toggle(); }
    };
    this.element.oncontextmenu = (event) => menu(event, [
      ...(!image ? [{ label: 'Save', hint: 'Ctrl/⌘+S', action: () => void this.save() }] : []),
      ...(canRender && !image ? [{ label: this.rendered ? 'Show source' : 'Show rendered', hint: 'Ctrl/⌘+L', action: () => this.toggle() }] : []),
      ...(image ? [{ label: 'Reset zoom', hint: 'Ctrl+scroll', action: () => { this.scale = 1; this.zoom(0); } }] : []),
    ]);
    this.text.onkeydown = (event) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        this.text.setRangeText('  ', this.text.selectionStart, this.text.selectionEnd, 'end');
        this.text.dispatchEvent(new Event('input'));
      }
    };
    this.preview.addEventListener('wheel', (event) => {
      if (image && event.ctrlKey) { event.preventDefault(); this.zoom(event.deltaY < 0 ? 0.1 : -0.1); }
    }, { passive: false });
    this.element.append(toolbar, this.text, this.preview);
    if (canRender) this.toggle();
  }
  private zoom(delta: number) {
    this.scale = Math.max(0.1, Math.min(5, this.scale + delta));
    const image = this.preview.querySelector('img');
    if (image) { image.style.maxWidth = 'none'; image.style.width = (image.naturalWidth * this.scale) + 'px'; }
  }
  private async toggle() {
    this.rendered = !this.rendered;
    this.text.hidden = this.rendered;
    this.preview.hidden = !this.rendered;
    this.mode?.setAttribute('aria-pressed', String(this.rendered));
    if (!this.rendered) return;
    this.preview.replaceChildren();
    const content = this.text.value;
    try {
      if (isImage(this.file.path)) {
        const image = document.createElement('img');
        image.src = await previewUrl(this.file.path);
        image.alt = this.file.path.split('/').pop() || '';
        image.onerror = () => this.status('Image could not be loaded: ' + this.file.path);
        this.preview.classList.add('image-view');
        this.preview.append(image);
      } else if (/\.(md|markdown|html?)$/i.test(this.file.path)) {
        const frame = document.createElement('iframe');
        frame.title = 'Rendered file';
        const html = /\.html?$/i.test(this.file.path);
        frame.setAttribute('sandbox', html ? 'allow-scripts allow-downloads' : 'allow-downloads');
        const base = new URL(await previewUrl(this.file.path), location.origin).href;
        const style = '<style>body{font:13px/1.65 system-ui;margin:16px;overflow-wrap:anywhere;color:#dce2e6;background:#191c1f}h1{font-size:22px}h2{font-size:18px}pre{overflow:auto;padding:10px;background:#111416}code{font:12px/1.6 monospace}img{max-width:100%}a{color:#a6d3b4}table{border-collapse:collapse}td,th{border:1px solid #485058;padding:5px 10px}</style>';
        frame.srcdoc = '<base href="' + base + '">' + (html ? content : style + marked.parse(content, { async: false }));
        this.preview.append(frame);
      } else if (/\.json$/i.test(this.file.path)) {
        this.preview.append(jsonTree(JSON.parse(content)));
      } else if (/\.(jsonl|ndjson)$/i.test(this.file.path)) {
        for (const [index, line] of content.split(/\r?\n/).entries()) {
          if (!line.trim()) continue;
          const card = document.createElement('article');
          card.className = 'jsonl-card';
          try { card.append(jsonTree(JSON.parse(line), 'Record ' + (index + 1))); }
          catch { card.textContent = line; }
          this.preview.append(card);
        }
        requestAnimationFrame(() => { this.preview.scrollTop = this.preview.scrollHeight; });
      } else if (/\.(csv|tsv)$/i.test(this.file.path)) {
        this.preview.append(table(content, this.file.path));
      } else {
        const log = document.createElement('pre');
        log.textContent = content;
        this.preview.append(log);
      }
    } catch (error) {
      this.preview.textContent = (error as Error).message;
      this.status('Cannot render ' + this.file.path + '. Source is available.');
    }
  }
  async save() {
    if (this.saving || isImage(this.file.path)) return;
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
