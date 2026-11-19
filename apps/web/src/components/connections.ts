import { profile, sshTarget } from '../connection';
import { button } from '../api';
import { popover } from './popover';

export function connectionsButton(host: HTMLElement, status: (message: string) => void) {
  const toggle = popover(host, 'Computers', (current) => {
    const info = document.createElement('div'); info.textContent = 'Loading local machine…'; current.append(info);
    const active = document.createElement('div'); current.append(active);
    const add = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Add SSH connection'; add.append(summary);
    const aliases = document.createElement('div'); aliases.className = 'ssh-aliases'; add.append(aliases);
    const form = document.createElement('form');
    const input = document.createElement('input'); input.setAttribute('aria-label', 'SSH command');
    input.placeholder = 'ssh -J jump -p 22 user@host';
    const submit = button('Connect', () => {}); submit.type = 'submit';
    const progress = document.createElement('div'); progress.setAttribute('role', 'status');
    const connect = async (command: string) => {
      for (const control of Array.from(current.querySelectorAll('button'))) control.disabled = true;
      progress.textContent = 'Connecting · preparing remote backend…';
      try {
        const response = await fetch('/api/ssh/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: command }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        const url = new URL(location.href); url.searchParams.set('ssh', command); if (profile !== 'default') url.searchParams.set('w', profile);
        location.assign(url.href);
      } catch (error) {
        progress.textContent = (error as Error).message;
        for (const control of Array.from(current.querySelectorAll('button'))) control.disabled = false;
      }
    };
    form.onsubmit = (event) => { event.preventDefault(); if (input.value.trim()) void connect(input.value.trim()); };
    form.append(input, submit); add.append(form); current.append(add, progress);
    void fetch('/api/ssh/hosts').then(async (response) => {
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
  toggle.textContent = 'Local machine';
  void fetch('/api/ssh/hosts').then((r) => r.json()).then((data) => { toggle.textContent = data.local.hostname; toggle.title = sshTarget ? 'Current remote: ' + sshTarget : 'Local machine'; }).catch(() => {});
}
