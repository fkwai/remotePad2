import { localFetch } from '../base';
import Papa from 'papaparse';
import { workspaceUrl } from '../connection';

let previewKey: Promise<string> | undefined;
export async function previewUrl(path: string) {
  previewKey ||= localFetch('/api/preview-key').then(async (response) => {
    if (!response.ok) throw new Error('Preview unavailable. Reload RemotePad.');
    return (await response.json()).key as string;
  });
  return workspaceUrl('/api/preview/' + await previewKey + '/' + path.split('/').filter(Boolean).map(encodeURIComponent).join('/'));
}
export const isImage = (path: string) => /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(path);
export function jsonTree(value: unknown, name = 'root', depth = 0): HTMLElement {
  if (depth > 50) {
    const truncated = document.createElement('pre');
    truncated.textContent = '…';
    return truncated;
  }
  if (value !== null && typeof value === 'object') {
    const details = document.createElement('details');
    details.open = depth < 2;
    const summary = document.createElement('summary');
    const entries = Object.entries(value);
    summary.textContent = name + (Array.isArray(value) ? ' [' + entries.length + ']' : ' {' + entries.length + '}');
    details.append(summary, ...entries.map(([key, child]) => jsonTree(child, key, depth + 1)));
    return details;
  }
  const leaf = document.createElement('div');
  leaf.className = 'json-leaf';
  leaf.textContent = name + ': ' + JSON.stringify(value);
  return leaf;
}
export function table(content: string, path: string) {
  const result = Papa.parse<string[]>(content, { delimiter: /\.tsv$/i.test(path) ? '\t' : '', skipEmptyLines: true });
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const body = document.createElement('tbody');
  result.data.forEach((cells, index) => {
    const row = document.createElement('tr');
    for (const value of cells) {
      const cell = document.createElement(index ? 'td' : 'th');
      cell.textContent = value; row.append(cell);
    }
    (index ? body : head).append(row);
  });
  table.append(head, body);
  return table;
}
