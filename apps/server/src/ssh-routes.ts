import os from 'node:os';
import { sshConfigHosts } from './ssh-hosts.ts';
import { request } from 'node:http';
import { createConnection } from 'node:net';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import WebSocket, { type RawData } from 'ws';
import { closeSsh as closeSshConnections, connectedHosts as connectedSshHosts, connectSsh, sshSocket as socketFor, parseSsh } from './ssh.ts';

const workerPath = /^\/api\/(?:health|files|file|sessions|codex|navigation)(?:\/|\?|$)/;
const workerSocket = /^\/ws\/(?:terminal|codex)\/[^/?]+$/;

function localBrowser(req: FastifyRequest) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip)) return false;
  const host = req.headers.host;
  if (!host || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)) return false;
  const origin = req.headers.origin;
  const sameOrigin = origin === `http://${host}` || origin === `https://${host}`;
  const site = req.headers['sec-fetch-site'];
  const directRead = site === 'none' && (req.method === 'GET' || req.method === 'HEAD');
  return (!origin || sameOrigin) && (!site || site === 'same-origin' || directRead);
}

export async function registerSshRoutes(app: FastifyInstance) {
  await app.register(async (router) => {
    router.addHook('onRequest', async (req, reply) => {
      if (!localBrowser(req)) return reply.code(403).send({ error: 'SSH connections are available from the local RemotePad browser.' });
    });

    router.get('/api/ssh/hosts', async () => ({
      local: {
        hostname: os.hostname(),
        user: os.userInfo().username,
        platform: os.platform(),
        arch: os.arch(),
        homedir: os.homedir(),
      },
      hosts: await sshConfigHosts(),
      connected: connectedSshHosts(),
    }));

    router.get<{ Params: { host: string } }>('/api/ssh/:host/status', async (req) => ({
      connected: Boolean(socketFor(req.params.host)),
    }));

    router.post<{ Body: { host?: string } }>('/api/ssh/connect', async (req, reply) => {
      const host = req.body?.host;
      if (typeof host !== 'string' || host.length > 1024) {
        return reply.code(400).send({ error: 'Enter an SSH config alias or user@hostname.' });
      }
      try {
        parseSsh(host);
        await connectSsh(host);
        return { connected: true };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    router.all<{ Params: { host: string } }>('/api/ssh/:host/proxy/*', async (req, reply) => {
      const path = '/api/' + req.url.split('/proxy/').slice(1).join('/proxy/');
      if (!workerPath.test(path)) return reply.code(404).send({ error: 'Remote operation unavailable.' });
      const socketPath = socketFor(req.params.host);
      if (!socketPath) return reply.code(503).send({ error: 'SSH disconnected. Reconnect from the SSH menu.' });
      const body = req.body === undefined ? undefined : JSON.stringify(req.body);
      return new Promise<void>((resolve) => {
        const upstream = request({
          socketPath, path, method: req.method,
          headers: body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        }, (res) => {
          reply.code(res.statusCode || 502);
          for (const name of ['content-type', 'content-length', 'content-disposition', 'cache-control']) {
            const value = res.headers[name];
            if (value !== undefined) reply.header(name, value);
          }
          reply.send(res);
          resolve();
        });
        upstream.on('error', () => {
          if (!reply.sent) reply.code(502).send({ error: 'SSH backend is unavailable.' });
          resolve();
        });
        reply.raw.once('close', () => upstream.destroy());
        upstream.end(body);
      });
    });

    router.get<{ Params: { host: string } }>('/ws/ssh/:host/*', { websocket: true }, (client, req) => {
      const socketPath = socketFor(req.params.host);
      const path = '/ws/' + req.url.split('/').slice(4).join('/');
      if (!socketPath || !workerSocket.test(path)) {
        client.close(1013, 'SSH backend unavailable');
        return;
      }

      const upstream = new WebSocket(`ws://localhost${path}`, {
        createConnection: () => createConnection(socketPath),
        handshakeTimeout: 5000,
        perMessageDeflate: false,
      });
      const queued: { data: RawData; binary: boolean }[] = [];
      client.on('message', (data, binary) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
        else if (queued.length < 32) queued.push({ data, binary });
        else client.close(1013, 'SSH backend is starting');
      });
      upstream.on('open', () => {
        for (const { data, binary } of queued) upstream.send(data, { binary });
        queued.length = 0;
      });
      upstream.on('message', (data, binary) => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
      });
      upstream.on('close', () => client.close(1013, 'SSH disconnected'));
      upstream.on('error', () => client.close(1013, 'SSH backend unavailable'));
      client.on('close', () => upstream.terminate());
      client.on('error', () => upstream.terminate());
    });
  });
  app.addHook('onClose', async () => closeSshConnections());
}
