import type { SshProgress } from '@remotepad2/protocol';
import type { SshConnectionPanel } from './ssh-connection';
import { localFetch } from '../base';
import { profile, sshTarget } from '../connection';
import { button } from '../api';
import { popover } from './popover';

export function connectionsButton(host: HTMLElement, status: (message: string) => void, showConnection: (command: string) => SshConnectionPanel) {
  const toggle = popover(host, 'Computers', (current, close) => {
    const info = document.createElement('div'); info.textContent = 'Loading local machine…'; current.append(info);
    const active = document.createElement('div'); current.append(active);
    const add = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Add SSH connection'; add.append(summary);
    const aliases = document.createElement('div'); aliases.className = 'ssh-aliases'; add.append(aliases);
    const form = document.createElement('form');
    const input = document.createElement('input'); input.setAttribute('aria-label', 'SSH command');
    input.placeholder = 'ssh -J jump -p 22 user@host';
    const submit = button('Connect', () => {}); submit.type = 'submit';
    const progress = document.createElement('div'); progress.setAttribute('role', 'status'); progress.className = 'connection-progress';
    current.append(progress);
    const connect = async (command: string) => {
      for (const control of Array.from(current.querySelectorAll('button'))) control.disabled = true;
      progress.textContent = 'Connecting to ' + command + ' · preparing remote backend…';
      status(progress.textContent);
      const view = showConnection(command);
      let finished = false;
      const readProgress = async (final = false) => {
        const response = await localFetch('/api/ssh/' + encodeURIComponent(command) + '/status?after=' + view.after);
        const data = await response.json() as SshProgress; if (response.ok && (!finished || final)) view.update(data); return data;
      };
      const started = Date.now();
      let checking = false;
      const poll = window.setInterval(() => {
        if (checking) return; checking = true;
        void readProgress().then((data) => {
          if (finished) return;
          const elapsed = Math.floor((Date.now() - (data.startedAt || started)) / 1000);
          const message = 'Connecting to ' + command + ' · ' + (data.phase || 'Preparing remote backend') + ' · ' + elapsed + 's';
          progress.textContent = message; status(message);
        }).catch(() => {}).finally(() => { checking = false; });
      }, 750);
      progress.scrollIntoView({ block: 'nearest' });
      try {
        const response = await localFetch('/api/ssh/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: command }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        const url = new URL(location.href); url.searchParams.set('ssh', command); if (profile !== 'default') url.searchParams.set('w', profile);
        finished = true; window.clearInterval(poll);
        await readProgress(true).catch(() => {});
        view.finish(url.href);
        const remote = window.open(url.href, '_blank');
        if (remote) { remote.opener = null; close(); status('Connected to ' + command + ' · opened in a new tab'); }
        else {
          progress.textContent = 'Connected · open remote workspace ↗';
          const open = document.createElement('a'); open.href = url.href; open.target = '_blank'; open.rel = 'noopener'; open.textContent = 'Open remote workspace'; progress.append(document.createElement('br'), open);
          status('Connected to ' + command + ' · use Open remote workspace in the connection terminal');
        }
      } catch (error) {
        finished = true; window.clearInterval(poll);
        await readProgress(true).catch(() => {}); view.finish(undefined, (error as Error).message);
        progress.textContent = (error as Error).message; status('SSH ' + command + ': ' + progress.textContent);
        for (const control of Array.from(current.querySelectorAll('button'))) control.disabled = false;
      } finally { finished = true; window.clearInterval(poll); }
    };
    form.onsubmit = (event) => { event.preventDefault(); if (input.value.trim()) void connect(input.value.trim()); };
    form.append(input, submit); add.append(form); current.append(add);
    void localFetch('/api/ssh/hosts').then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (!current.isConnected) return;
      const heading = document.createElement('h3'); heading.textContent = data.local.hostname;
      const description = document.createElement('p'); description.textContent = `${data.local.user} · ${data.local.platform} ${data.local.arch}`;
      const home = document.createElement('small'); home.textContent = data.local.homedir;
      const local = button(sshTarget ? 'Switch to local' : '● Local machine', () => { const url = new URL(location.href); url.searchParams.delete('ssh'); location.assign(url.href); });
      info.replaceChildren(heading, description, home, local);
      const connected = [...new Set<string>([...(sshTarget ? [sshTarget] : []), ...data.connected])];
      if (connected.length) {
        const heading = document.createElement('h3'); heading.textContent = 'Remote machines'; active.append(heading);
        for (const name of connected) active.append(button((name === sshTarget ? '● ' : '') + name + (data.connected.includes(name) ? ' · Connected' : ' · Disconnected'), () => void connect(name)));
      }
      for (const name of data.hosts) aliases.append(button(name, () => void connect(name)));
      if (!data.hosts.length) aliases.textContent = 'No SSH config hosts found.';
    }).catch((error) => { info.textContent = 'Machine information unavailable'; status(error.message); });
  });
  toggle.textContent = sshTarget || 'Local machine';
  toggle.title = sshTarget ? 'SSH: ' + sshTarget + '' : 'Local machine';
  toggle.classList.toggle('remote-target', Boolean(sshTarget));
  void localFetch('/api/ssh/hosts').then((r) => r.json()).then((data) => { if (!sshTarget) { toggle.textContent = data.local.hostname; toggle.title = 'Local machine'; } }).catch(() => {});
  return (remoteHostname: string) => { if (sshTarget) toggle.title = 'SSH: ' + sshTarget + ' · ' + remoteHostname; };
}
