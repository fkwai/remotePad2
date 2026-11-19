import { localFetch, entryUrl } from './base';
import { machineKey, profile, sshTarget, workspaceKey } from './connection';
export interface WindowProfile { id: string; ssh: string; name: string; state: Record<string, string>; updated: number }
const keys = ['panel-sizes', 'fixed-visibility', 'directory', 'session', 'session.main', 'session.dev', 'session.nightly', 'editor-tabs', 'active-file', 'secondary-file', 'editor-split', 'editor-ratio', 'show-hidden'];
let ready = false, last = '', timer: number | undefined;
const route = '/api/windows/' + encodeURIComponent(profile);
export const windowUrl = (id: string, ssh = sshTarget) => {
  const url = entryUrl(); if (id !== 'default') url.searchParams.set('w', id); if (ssh) url.searchParams.set('ssh', ssh); return url.href;
};
export async function windowList(): Promise<WindowProfile[]> {
  const response = await localFetch('/api/windows'); if (!response.ok) throw new Error('Window profiles require the updated backend.'); return (await response.json()).windows;
}
export async function initializeWindow() {
  const reset = new URLSearchParams(location.search).has('reset');
  try {
    const rows = await windowList();
    const row = rows.find((row) => row.id === profile && row.ssh === sshTarget);
    if (reset) for (const key of keys) localStorage.removeItem(workspaceKey(key));
    else if (row) for (const key of keys) { if (row.state[key] !== undefined) localStorage.setItem(workspaceKey(key), row.state[key]); else localStorage.removeItem(workspaceKey(key)); }
    // Migrate names from the earlier browser-only registry without discarding it.
    if (!row) {
      const old = JSON.parse(localStorage.getItem(machineKey('windows')) || '[]').find((item: any) => item.id === profile);
      await saveWindow(old?.name || (profile === 'default' ? 'Default' : profile));
    }
  } catch { /* Older backends retain browser-local profiles. */ }
  if (reset) { for (const key of keys) localStorage.removeItem(workspaceKey(key)); const url = new URL(location.href); url.searchParams.delete('reset'); history.replaceState(null, '', url); }
  ready = true;
}
function snapshot() { return Object.fromEntries(keys.flatMap((key) => { const value = localStorage.getItem(workspaceKey(key)); return value === null ? [] : [[key, value]]; })); }
export async function saveWindow(name?: string) {
  const state = snapshot();
  const response = await localFetch(route, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ssh: sshTarget, state, ...(name === undefined ? {} : { name }) }), keepalive: true });
  if (!response.ok) throw new Error('Could not save window profile.'); last = JSON.stringify(state);
}
export function startWindowSave() {
  if (!ready) return;
  timer = window.setInterval(() => { if (JSON.stringify(snapshot()) !== last) void saveWindow().catch(() => {}); }, 1000);
  window.addEventListener('pagehide', () => { clearInterval(timer); if (ready) void saveWindow().catch(() => {}); });
}
export async function forgetWindow(row: WindowProfile) {
  const response = await localFetch('/api/windows/' + encodeURIComponent(row.id) + '?ssh=' + encodeURIComponent(row.ssh), { method: 'DELETE' });
  if (!response.ok) throw new Error('Could not forget window.');
  if (row.id === profile && row.ssh === sshTarget) { ready = false; clearInterval(timer); const url = new URL(location.href); url.searchParams.set('reset', '1'); location.replace(url.href); }
}
