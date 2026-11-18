import os from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import type { Navigation, PinnedFolder } from '@remotepad2/protocol';

const dir = path.join(os.homedir(), '.remotepad2');
const file = path.join(dir, 'navigation.json');
function folders(file: string): PinnedFolder[] {
  try {
    const rows = JSON.parse(readFileSync(file, 'utf8')).folders;
    return Array.isArray(rows) ? rows.filter((row) => typeof row?.path === 'string' && typeof row?.name === 'string')
      .map(({ path, name }) => ({ path, name })) : [];
  } catch { return []; }
}
function read(): Navigation {
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const initial = {
    favorites: folders(path.join(os.homedir(), '.remotepad', 'favorites.json')),
    repos: folders(path.join(os.homedir(), '.remotepad', 'workspaces.json')),
  };
  write(initial);
  return initial;
}
function write(data: Navigation) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(file + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(file + '.tmp', file);
}
function git(root: string, ...args: string[]) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}
export async function registerNavigation(app: FastifyInstance) {
  app.get('/api/navigation', async () => {
    const data = read();
    return { ...data, repos: data.repos.map((repo) => {
      try { return { ...repo, branch: git(repo.path, 'branch', '--show-current') || 'detached' }; }
      catch { return repo; }
    }) };
  });
  app.post<{ Body: { kind: 'favorites' | 'repos'; path: string; remove?: boolean } }>('/api/navigation', async (req, reply) => {
    try {
      const { kind, remove } = req.body;
      if (kind !== 'favorites' && kind !== 'repos') return reply.code(400).send({ error: 'Invalid list' });
      let target = path.resolve(req.body.path);
      if (!remove) {
        if (!statSync(target).isDirectory()) throw new Error('Choose a directory.');
        if (kind === 'repos') target = git(target, 'rev-parse', '--show-toplevel');
      }
      const data = read();
      data[kind] = data[kind].filter((row) => row.path !== target);
      if (!remove) data[kind].push({ path: target, name: path.basename(target) || target });
      write(data);
      return { ok: true };
    } catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
  });
}
