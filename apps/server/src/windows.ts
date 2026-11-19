import os from 'node:os';
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
export interface WindowProfile { id: string; ssh: string; name: string; state: Record<string, string>; updated: number }
export function registerWindows(app: FastifyInstance, home = os.homedir()) {
  const file = path.join(home, '.remotepad2/windows.json');
  const read = (): WindowProfile[] => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return []; } };
  const write = (rows: WindowProfile[]) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file + '.tmp', JSON.stringify(rows), { mode: 0o600 }); renameSync(file + '.tmp', file); };
  app.get('/api/windows', async () => ({ windows: read() }));
  app.put<{ Params: { id: string }; Body: { ssh?: string; name?: string; state?: Record<string, string> } }>('/api/windows/:id', { bodyLimit: 2 * 1024 * 1024 }, async (req, reply) => {
    const { id } = req.params; const { ssh = '', name, state } = req.body;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || typeof ssh !== 'string' || ssh.length > 1024 || (name !== undefined && typeof name !== 'string') || (state !== undefined && (!state || Array.isArray(state) || typeof state !== 'object' || Object.values(state).some((value) => typeof value !== 'string')))) return reply.code(400).send({ error: 'Invalid window profile.' });
    const rows = read(); let row = rows.find((row) => row.id === id && row.ssh === ssh);
    if (!row) { row = { id, ssh, name: name || id, state: {}, updated: Date.now() }; rows.push(row); }
    if (name !== undefined) row.name = name.slice(0, 200);
    if (state !== undefined) row.state = state;
    row.updated = Date.now(); write(rows); return row;
  });
  app.delete<{ Params: { id: string }; Querystring: { ssh?: string } }>('/api/windows/:id', async (req) => { write(read().filter((row) => row.id !== req.params.id || row.ssh !== (req.query.ssh || ''))); return { ok: true }; });
}
