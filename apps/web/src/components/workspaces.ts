import { localFetch, channel as activeChannel } from '../base';
import { button } from '../api';
import { profile, sshTarget } from '../connection';
import { forgetWindow, saveWindow, windowList, windowUrl } from '../windows';
import { popover } from './popover';
import { menu } from './menu';

export function workspaceMenu(host: HTMLElement) {
  const toggle = popover(host, 'RemotePad2', (body, close) => {
    const head = document.createElement('div'); head.className = 'version-pop-head'; head.append('RemotePad2', button('×', close, 'Close sessions menu')); body.append(head);
    const error = document.createElement('div'); error.className = 'error'; body.append(error);
    const heading = document.createElement('div'); heading.className = 'version-windows-head';
    heading.append('Sessions', button('+ New', () => {
      void saveWindow().catch(() => {});
      window.open(windowUrl(crypto.randomUUID()), '_blank', 'noopener');
    }, 'Open new workspace window'));
    body.append(heading);
    const count = document.createElement('small'); body.append(count);
    const list = document.createElement('div'); body.append(list);
    const hostname = localFetch('/api/ssh/hosts').then(r=>r.json()).then(data=>data.local.hostname as string).catch(()=>'Local machine');
    const render = async () => {
      try {
        await saveWindow(); const [rows,localHostname] = await Promise.all([windowList(),hostname]); list.replaceChildren();
        count.textContent = rows.length + (rows.length === 1 ? ' session' : ' sessions');
        for (const row of rows) {
          const current = row.id === profile && row.ssh === sshTarget;
          const line = document.createElement('div'); line.className = 'workspace-row' + (current ? ' current' : '');
          const open = button('', () => window.open(windowUrl(row.id, row.ssh), '_blank', 'noopener'));
          const name = document.createElement('span'); name.className = 'version-window-label'; name.textContent = (row.name === row.id || row.name === 'Default') ? (row.state.directory?.split('/').filter(Boolean).pop() || row.name) : row.name; open.title = row.state.directory || row.name;
          const detail = document.createElement('small'); detail.textContent = (row.ssh || localHostname) + (current ? ' · here' : ''); open.append(name, detail);
          const rename = async () => {
            const name = prompt('Window name', row.name); if (!name?.trim()) return;
            const response = await localFetch('/api/windows/' + encodeURIComponent(row.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ssh: row.ssh, name: name.trim() }) });
            if (!response.ok) { error.textContent = 'Could not rename window.'; return; } void render();
          };
          open.oncontextmenu = (event) => menu(event, [
            { label: 'Open in this window', action: async () => { await saveWindow().catch(() => {}); location.assign(windowUrl(row.id, row.ssh)); } },
            { label: 'Open in new window', action: () => window.open(windowUrl(row.id, row.ssh), '_blank', 'noopener') },
            { label: 'Rename', action: () => void rename() },
            { label: 'Forget saved layout', action: () => void forgetWindow(row).then(() => { if (!current) void render(); }).catch((err) => { error.textContent = err.message; }) },
          ]);
          line.append(open, button('×', () => void forgetWindow(row).then(() => { if (!current) void render(); }).catch((err) => { error.textContent = err.message; }), current ? 'Forget this layout and start blank' : 'Forget saved window'));
          list.append(line);
        }
      } catch (err) { error.textContent = (err as Error).message; }
    };
    void render();
  });
  toggle.classList.add('brand'); toggle.setAttribute('aria-label', 'RemotePad2');
  const mark = document.createElement('span'); mark.className = 'brand-mark';
  const name = document.createElement('span'); name.className = 'brand-name'; name.textContent = 'RemotePad2';
  toggle.replaceChildren(mark, name);
}

export function versionMenu(host: HTMLElement) {
  const toggle = popover(host, 'Versions', (body) => {
    const version = document.createElement('div'); version.className = 'version-info'; version.textContent = 'Loading version…'; body.append(version);
    const error = document.createElement('div'); error.className = 'error'; body.append(error);
    void localFetch('/api/version').then(async (response) => {
      if (!response.ok) throw new Error('Version information requires the updated backend.');
      const info = await response.json();
      version.replaceChildren();
      const title = document.createElement('strong'); title.textContent = 'v' + info.version;
      const meta = document.createElement('span'); meta.textContent = `${info.branch}@${info.commit}`;
      version.append(title, meta);
      if (info.dirty) { const dirty = document.createElement('small'); dirty.textContent = 'local changes'; version.append(dirty); }
      const channels = document.createElement('div'); channels.className = 'version-channels';
      const heading = document.createElement('h3'); heading.textContent = 'Versions'; channels.append(heading);
      body.append(channels);
      if (activeChannel) {
        const rows = document.createElement('div'); channels.append(rows);
        const refresh = async () => {
          if (!body.isConnected) return;
          try {
            const response = await fetch('/_gateway/lanes'); const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            rows.replaceChildren(...data.lanes.map((lane: {name:string;alive:boolean;phase?:string;commit?:string;error?:string;url:string}) => {
              const row = document.createElement('div'); row.className = 'version-branch-row';
              const name = document.createElement('span'); name.textContent = lane.name;
              const meta = document.createElement('small'); meta.textContent = [lane.commit, lane.alive ? lane.name === activeChannel ? 'here' : 'running' : lane.phase || 'stopped'].filter(Boolean).join(' · '); meta.title = lane.error || '';
              const action = button(lane.alive ? 'Switch' : 'Start', () => {});
              action.disabled = lane.name === activeChannel || (!lane.alive && ['Preparing checkout','Installing and building','Starting'].includes(lane.phase || ''));
              action.onclick = async (event) => {
                try {
                  if (lane.alive) {
                    await saveWindow(); const url = new URL(lane.url, location.origin); url.search = location.search;
                    if (event.ctrlKey || event.metaKey) window.open(url.href, '_blank', 'noopener'); else location.assign(url.href);
                  } else {
                    action.disabled = true;
                    const response = await fetch('/_gateway/lanes/' + lane.name + '/start', {method:'POST'});
                    const result = await response.json(); if (!response.ok) throw new Error(result.error); void refresh();
                  }
                } catch (err) { error.textContent = (err as Error).message; action.disabled = false; }
              };
              row.append(name, meta, action); return row;
            }));
          } catch (err) { error.textContent = (err as Error).message; }
          if (body.isConnected) window.setTimeout(refresh, 1500);
        };
        void refresh();
      } else for (const branch of (info.branches || []).filter((branch:{name:string})=>['main','dev','nightly'].includes(branch.name))) {
        const row = document.createElement('div'); row.className = 'version-branch-row'; const name = document.createElement('span'); name.textContent = branch.name;
        const commit = document.createElement('small'); commit.textContent = branch.commit + (branch.name === info.branch ? ' · here' : ''); row.append(name, commit); channels.append(row);
      }
    }).catch((err) => { version.textContent = err.message; });
  });
  toggle.classList.add('brand-channel');
  toggle.setAttribute('aria-label', 'Switch version');
  toggle.textContent = activeChannel || 'dev';
  toggle.title = 'Switch version';
  if (!activeChannel) void localFetch('/api/version').then(r=>r.json()).then(info=>{toggle.textContent=info.branch;}).catch(()=>{});
}
