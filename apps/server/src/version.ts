import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
const run = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
export function registerVersion(app: FastifyInstance) {
  app.get('/api/version', async () => {
    const git = async (...args: string[]) => (await run('git', ['-C', root, ...args], { timeout: 2000 })).stdout.trim();
    const version = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
    try {
      const [branch, commit, changes, refs] = await Promise.all([git('branch', '--show-current'), git('rev-parse', '--short', 'HEAD'), git('status', '--porcelain'), git('for-each-ref', '--format=%(refname:short) %(objectname:short)', 'refs/heads/')]);
      return { version, branch: process.env.REMOTEPAD2_CHANNEL || branch || 'detached', commit, dirty: Boolean(changes), branches: refs.split('\n').filter(Boolean).map((line) => { const [name, commit] = line.split(' '); return { name, commit }; }) };
    } catch { return { version, branch: 'installed', commit: 'unknown', dirty: false }; }
  });
}
