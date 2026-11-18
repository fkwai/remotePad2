import { workspaceUrl } from './connection';
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url.startsWith('/api/ssh/') ? url : workspaceUrl(url), { ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || response.statusText);
  return body;
}
export function button(label: string, action: () => void, title?: string) {
  const element = document.createElement('button');
  element.textContent = label;
  element.onclick = action;
  if (title) element.title = title;
  return element;
}
