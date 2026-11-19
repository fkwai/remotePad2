import { workspaceKey } from '../connection';
import { popover } from './popover';
import { button } from '../api';

export type Area = 'files' | 'sessions' | 'editor' | 'terminal';
const names: Record<Area, string> = { files: 'Files', sessions: 'Sessions', editor: 'Editor', terminal: 'Terminal' };
export class Layout {
  visible: Record<Area, boolean> = { files: true, sessions: true, editor: true, terminal: true };
  private sizes = { left: 250, right: 280, split: 0.6 };
  private handles: HTMLElement[] = [];
  constructor(private get: (id: string) => HTMLElement) {
    try {
      const visible = JSON.parse(localStorage.getItem(workspaceKey('fixed-visibility')) || '{}');
      for (const area of Object.keys(names) as Area[]) if (typeof visible[area] === 'boolean') this.visible[area] = visible[area];
      const sizes = JSON.parse(localStorage.getItem(workspaceKey('panel-sizes')) || '{}');
      for (const name of ['left', 'right', 'split'] as const) if (Number.isFinite(sizes[name])) this.sizes[name] = sizes[name];
    } catch {}
    for (const kind of ['left', 'split', 'right'] as const) {
      const handle = document.createElement('div');
      handle.className = 'resize-handle ' + (kind === 'split' ? 'horizontal' : 'vertical');
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-label', { left: 'Files width', right: 'Sessions width', split: 'Editor height' }[kind]);
      handle.setAttribute('aria-orientation', kind === 'split' ? 'horizontal' : 'vertical');
      handle.tabIndex = 0;
      const parent = kind === 'split' ? get('workspace') : get('workbench');
      parent.insertBefore(handle, get(kind === 'left' ? 'workspace' : kind === 'right' ? 'sessions-index' : 'terminal'));
      handle.onpointerdown = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        const shield = document.createElement('div');
        shield.className = 'resize-shield ' + (kind === 'split' ? 'horizontal' : 'vertical');
        document.body.append(shield);
        const update = (e: PointerEvent) => {
          const bounds = get(kind === 'split' ? 'workspace' : 'workbench').getBoundingClientRect();
          if (kind === 'split') this.sizes.split = Math.max(0.15, Math.min(0.85, (e.clientY - bounds.top) / bounds.height));
          else this.sizes[kind] = Math.max(150, Math.min(bounds.width * 0.4, kind === 'left' ? e.clientX - bounds.left : bounds.right - e.clientX));
          this.apply();
        };
        handle.onpointermove = update;
        const end = () => { shield.remove(); handle.onpointermove = null; handle.onpointerup = null; handle.onpointercancel = null; this.save(); };
        handle.onpointerup = end;
        handle.onpointercancel = end;
      };
      handle.onkeydown = (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const direction = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
        if (kind === 'split') this.sizes.split = Math.max(0.15, Math.min(0.85, this.sizes.split + direction * 0.02));
        else this.sizes[kind] = Math.max(150, Math.min(innerWidth * 0.4, this.sizes[kind] + direction * (kind === 'right' ? -10 : 10)));
        this.apply(); this.save();
      };
      this.handles.push(handle);
    }
    window.addEventListener('resize', () => this.apply());
  }
  menu(host: HTMLElement) {
    popover(host, 'Layout', (body) => {
      body.classList.add('layout-popover');
      const grid = document.createElement('div'); grid.className = 'layout-grid';
      for (const area of Object.keys(names) as Area[]) {
        const control = button(names[area], () => { this.visible[area] = !this.visible[area]; this.apply(); control.setAttribute('aria-pressed', String(this.visible[area])); });
        control.className = 'layout-cell layout-' + area;
        control.setAttribute('aria-pressed', String(this.visible[area])); grid.append(control);
      }
      for (let n = 0; n < 3; n++) { const empty = document.createElement('div'); empty.className = 'layout-unused'; empty.setAttribute('aria-hidden', 'true'); grid.append(empty); }
      body.append(grid, button('Reset layout', () => {
        this.sizes = { left: 250, right: 280, split: 0.6 };
        for (const key of Object.keys(names) as Area[]) this.visible[key] = true;
        this.apply(); this.save();
        for (const control of Array.from(grid.querySelectorAll('button'))) control.setAttribute('aria-pressed', 'true');
      }));
    });
  }
  apply() {
    for (const [area, id] of [['files', 'files-index'], ['sessions', 'sessions-index'], ['editor', 'editor'], ['terminal', 'terminal']] as const) this.get(id).hidden = !this.visible[area];
    const width = this.get('workbench').clientWidth;
    this.get('files-index').style.width = Math.min(this.sizes.left, width * 0.4) + 'px';
    this.get('sessions-index').style.width = Math.min(this.sizes.right, width * 0.4) + 'px';
    this.get('editor').style.flex = String(this.sizes.split);
    this.get('terminal').style.flex = String(1 - this.sizes.split);
    this.handles[0].hidden = !this.visible.files || !(this.visible.editor || this.visible.terminal);
    this.handles[1].hidden = !this.visible.editor || !this.visible.terminal;
    this.handles[2].hidden = !this.visible.sessions || !(this.visible.editor || this.visible.terminal);
    localStorage.setItem(workspaceKey('fixed-visibility'), JSON.stringify(this.visible));
  }
  private save() { localStorage.setItem(workspaceKey('panel-sizes'), JSON.stringify(this.sizes)); }
}
