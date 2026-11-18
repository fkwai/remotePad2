import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import { existsSync } from 'node:fs';
import { registerSshRoutes } from './ssh-routes.ts';
import { registerCodexApp } from './codex-app.ts';
import { registerNavigation } from './navigation.ts';
import { registerFiles } from './files.ts';
import { registerTerminal } from './terminal.ts';

const workerSocket = process.env.REMOTEPAD2_WORKER_SOCKET;
const app = Fastify({ logger: true });
const port = Number(process.env.REMOTEPAD2_PORT || 6020);
await app.register(websocket);
app.addHook('onRequest', async (request, reply) => {
  if (workerSocket) return;
  const origin = request.headers.origin;
  const allowed = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`,
    'http://127.0.0.1:6021', 'http://localhost:6021']);
  const site = request.headers['sec-fetch-site'];
  if (!allowed.has(`http://${request.headers.host}`) || (origin && !allowed.has(origin)) || site === 'cross-site') {
    return reply.code(403).send({ error: 'Open RemotePad2 from its local address.' });
  }
});
app.get('/api/health', async () => ({ ok: true, hostname: os.hostname() }));
await registerTerminal(app);
await registerCodexApp(app);
await registerFiles(app);
await registerNavigation(app);
if (!workerSocket) await registerSshRoutes(app);
const web = fileURLToPath(new URL('../../web/dist/', import.meta.url));
if (!workerSocket && existsSync(path.join(web, 'index.html'))) await app.register(staticFiles, { root: web });
if (workerSocket) {
  const { unlink } = await import('node:fs/promises');
  await unlink(workerSocket).catch(() => {});
  await app.listen({ path: workerSocket });
} else await app.listen({ host: '127.0.0.1', port });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
