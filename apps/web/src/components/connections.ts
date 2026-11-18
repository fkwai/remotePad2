import { sshTarget } from '../connection';
import { button } from '../api';

export function connectionsButton(host: HTMLElement, status: (message: string) => void) {
  let menu: HTMLElement | null = null;
  const toggle = button('Computers', () => {
    if (menu) { menu.remove(); menu = null; return; }
    menu = document.createElement('section');
    menu.className = 'connections-menu';
    const current = menu;
    const close = button('×', () => { menu?.remove(); menu = null; }, 'Close connections');
    current.append(close);
    const refresh = async () => {
      try {
        const response = await fetch('/api/ssh/hosts');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (current !== menu) return;
        const local = button(data.local.hostname + ' · Local', () => window.open(location.origin, '_blank', 'noopener'));
        current.append(local);
        for (const name of [...new Set<string>([...data.connected, ...data.hosts])]) {
          current.append(button(name + (data.connected.includes(name) ? ' · Connected' : ''), () => void connect(name)));
        }
      } catch (error) { status((error as Error).message); }
    };
    const form = document.createElement('form');
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'SSH command');
    input.placeholder = 'ssh user@host - use -p, -i, -J before host';
    const submit = button('Connect', () => {});
    submit.type = 'submit';
    const progress = document.createElement('div');
    progress.setAttribute('role', 'status');
    const connect = async (command: string) => {
      for (const control of Array.from(current.querySelectorAll('button'))) control.disabled = true;
      progress.textContent = 'Connecting · preparing remote backend…';
      try {
        const response = await fetch('/api/ssh/connect', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: command }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        const url = new URL(location.origin);
        url.searchParams.set('ssh', command);
        location.assign(url.href);
      } catch (error) {
        progress.textContent = (error as Error).message;
        for (const control of Array.from(current.querySelectorAll('button'))) control.disabled = false;
      }
    };
    form.onsubmit = (event) => { event.preventDefault(); if (input.value.trim()) void connect(input.value.trim()); };
    form.append(input, submit);
    current.append(form, progress);
    host.append(current);
    void refresh();
  });
  toggle.textContent = sshTarget || 'Computers';
  host.replaceChildren(toggle);
  void fetch('/api/ssh/hosts').then((r) => r.json()).then((data) => {
    toggle.textContent = data.local.hostname + (sshTarget ? ' → ' + sshTarget : '');
  }).catch(() => {});
}
