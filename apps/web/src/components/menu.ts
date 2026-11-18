export interface MenuAction { label: string; hint?: string; action: () => void }
let dismiss: (() => void) | undefined;
export function menu(event: MouseEvent, actions: MenuAction[]) {
  event.preventDefault();
  dismiss?.();
  const element = document.createElement('div');
  element.className = 'context-menu';
  element.setAttribute('role', 'menu');
  const controller = new AbortController();
  dismiss = () => { element.remove(); controller.abort(); dismiss = undefined; };
  for (const action of actions) {
    const row = document.createElement('button');
    row.setAttribute('role', 'menuitem');
    const label = document.createElement('span');
    label.textContent = action.label;
    const hint = document.createElement('small');
    hint.textContent = action.hint || '';
    row.append(label, hint);
    row.onclick = () => { dismiss?.(); action.action(); };
    element.append(row);
  }
  document.body.append(element);
  element.style.left = Math.max(0, Math.min(event.clientX, innerWidth - element.offsetWidth)) + 'px';
  element.style.top = Math.max(0, Math.min(event.clientY, innerHeight - element.offsetHeight)) + 'px';
  document.addEventListener('pointerdown', (e) => { if (!element.contains(e.target as Node)) dismiss?.(); }, { signal: controller.signal });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismiss?.(); }, { signal: controller.signal });
}
