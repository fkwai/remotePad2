import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { createReadStream, readFileSync, realpathSync, statSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';

const LIMIT = 2 * 1024 * 1024;
const revision = (data: Buffer) => createHash('sha256').update(data).digest('hex');
function read(file: string) {
  if (!statSync(file).isFile()) throw new Error('Choose a regular file.');
  if (statSync(file).size > LIMIT) throw new Error('File exceeds the 2 MB editor limit.');
  const bytes = readFileSync(file);
  if (bytes.includes(0)) throw new Error('Binary file cannot be edited as text.');
  return { path: file, content: new TextDecoder('utf-8', { fatal: true }).decode(bytes), revision: revision(bytes) };
}
export async function registerFiles(app: FastifyInstance) {
  app.get<{ Params: { key: string; '*': string } }>('/api/preview/:key/*', async (req, reply) => {
    try {
      const file = realpathSync('/' + req.params['*']);
      const info = await stat(file);
      if (!info.isFile()) return reply.code(400).send({ error: 'Choose a file.' });
      if (info.size > 32 * 1024 * 1024) return reply.code(413).send({ error: 'Preview exceeds 32 MB.' });
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        '.bmp': 'image/bmp', '.ico': 'image/x-icon',
        '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
        '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json',
      };
      reply.header('content-security-policy', 'sandbox allow-scripts allow-downloads');
      reply.header('x-content-type-options', 'nosniff');
      reply.header('cache-control', 'no-cache');
      reply.type(types[path.extname(file).toLowerCase()] || 'text/plain; charset=utf-8');
      return reply.send(createReadStream(file));
    } catch (error) { return reply.code(404).send({ error: (error as Error).message }); }
  });

  app.get<{ Querystring: { path?: string; details?: string } }>('/api/files', async (req, reply) => {
    try {
      const directory = path.resolve(req.query.path || os.homedir());
      if (!(await stat(directory)).isDirectory()) return reply.code(400).send({ error: 'Choose a directory.' });
      const entries = await readdir(directory, { withFileTypes: true });
      const listing = entries
        .filter((e) => e.isDirectory() || e.isFile())
        .map((e) => ({ name: e.name, path: path.join(directory, e.name), directory: e.isDirectory() }))
        .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
      const detailed = req.query.details === '1' ? await Promise.all(listing.map(async (entry) => {
        try { const info = await stat(entry.path); return { ...entry, size: info.size, modifiedAt: info.mtimeMs }; } catch { return entry; }
      })) : listing;
      return { path: directory, parent: path.dirname(directory), entries: detailed };
    } catch (error) { return reply.code(400).send({ error: String((error as Error).message) }); }
  });
  app.get<{ Querystring: { path: string } }>('/api/file', async (req, reply) => {
    try { return read(realpathSync(req.query.path)); }
    catch (error) { return reply.code(400).send({ error: String((error as Error).message) }); }
  });
  app.put<{ Body: { path: string; content: string; revision: string } }>('/api/file', { bodyLimit: LIMIT + 65536 }, async (req, reply) => {
    let temporary = '';
    try {
      const body = req.body;
      if (typeof body.content !== 'string' || Buffer.byteLength(body.content) > LIMIT) {
        return reply.code(400).send({ error: 'Invalid file content or file too large.' });
      }
      const file = realpathSync(body.path);
      const current = read(file);
      if (current.revision !== body.revision) return reply.code(409).send({ error: 'File changed on disk. Reopen it to compare before saving.' });
      temporary = path.join(path.dirname(file), '.' + path.basename(file) + '.' + randomUUID());
      writeFileSync(temporary, body.content, { flag: 'wx', mode: statSync(file).mode });
      renameSync(temporary, file);
      temporary = '';
      return read(file);
    } catch (error) { return reply.code(400).send({ error: String((error as Error).message) }); }
    finally { if (temporary) try { unlinkSync(temporary); } catch {} }
  });
}
