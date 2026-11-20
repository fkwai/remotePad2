import { button } from '../api';

export function popover(host: HTMLElement, label: string, build: (body: HTMLElement, close: () => void) => void) {
  let body: HTMLElement | undefined;
  let abort: AbortController | undefined;
  const close = () => { body?.remove(); body = undefined; abort?.abort(); toggle.setAttribute('aria-expanded', 'false'); };
  const toggle = button(label, () => {
    if (body) { close(); return; }
    body = document.createElement('section');
    body.className = 'popover';
    body.setAttribute('aria-label', label);
    abort = new AbortController();
    host.append(body);
    toggle.setAttribute('aria-expanded', 'true');
    build(body, close);
    document.addEventListener('pointerdown', (event) => { if (!host.contains(event.target as Node)) close(); }, { signal: abort.signal });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); close();
    }, { capture: true, signal: abort.signal });
  });
  toggle.setAttribute('aria-expanded', 'false');
  host.classList.add('popover-host');
  host.append(toggle);
  return toggle;
}
