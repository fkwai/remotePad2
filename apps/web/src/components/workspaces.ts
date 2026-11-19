import { button } from '../api';
import { machineKey, profile, workspaceKey } from '../connection';
import { popover } from './popover';

interface Workspace { id: string; name: string }
export function workspaceMenu(host: HTMLElement) {
  const read = (): Workspace[] => {
    try {
      const rows = JSON.parse(localStorage.getItem(machineKey('windows')) || '[]');
      return Array.isArray(rows) ? rows.filter((row) => typeof row.id === 'string' && typeof row.name === 'string') : [];
    } catch { return []; }
  };
  let rows = read();
  if (!rows.some((row) => row.id === 'default')) rows.unshift({ id: 'default', name: 'Default' });
  if (!rows.some((row) => row.id === profile)) rows.push({ id: profile, name: profile });
  localStorage.setItem(machineKey('windows'), JSON.stringify(rows));
  popover(host, 'RemotePad2', (body) => {
    rows = read();
    const version = document.createElement('div'); version.className = 'version-info'; version.textContent = 'Loading version…'; body.append(version);
    void fetch('/api/version').then(async (response) => {
      if (!response.ok) throw new Error();
      const info = await response.json();
      version.textContent = `v${info.version} · ${info.branch} · ${info.commit}${info.dirty ? ' · modified' : ''}`;
    }).catch(() => { version.textContent = 'Version information requires the updated backend.'; });
    const heading = document.createElement('h3'); heading.textContent = 'Workspace sessions'; body.append(heading);
    const list = document.createElement('div'); body.append(list);
    const save = () => localStorage.setItem(machineKey('windows'), JSON.stringify(rows));
    const go = (id: string) => { const url = new URL(location.href); if (id === 'default') url.searchParams.delete('w'); else url.searchParams.set('w', id); location.assign(url.href); };
    const render = () => {
      list.replaceChildren();
      for (const row of rows) {
        const line = document.createElement('div'); line.className = 'workspace-row';
        const open = button((row.id === profile ? '● ' : '') + row.name, () => go(row.id));
        open.setAttribute('aria-current', String(row.id === profile));
        line.append(open, button('✎', () => { const name = prompt('Workspace session name', row.name); if (name?.trim()) { row.name = name.trim(); save(); render(); } }, 'Rename workspace session'),
          button('×', () => {
            if (!confirm('Forget saved layout for ' + row.name + '? Running shells will remain available.')) return;
            const prefix = row.id === profile ? workspaceKey('') : machineKey(row.id === 'default' ? '' : 'window.' + encodeURIComponent(row.id) + '.');
            for (const key of ['panel-sizes', 'fixed-visibility', 'directory', 'session', 'editor-tabs', 'active-file']) localStorage.removeItem(prefix + key);
            rows = rows.filter((item) => item.id !== row.id || item.id === 'default'); save();
            if (row.id === profile) location.reload(); else render();
          }, 'Forget workspace session'));
        list.append(line);
      }
    };
    render();
    body.append(button('+ New workspace session', () => {
      const name = prompt('Workspace session name', 'New workspace'); if (!name?.trim()) return;
      const id = crypto.randomUUID(); rows.push({ id, name: name.trim() }); save(); go(id);
    }));
    const hint = document.createElement('small'); hint.textContent = 'Each session keeps its directory, open files, shell selection and layout. Switching does not stop shells.'; body.append(hint);
  });
}
