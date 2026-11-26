import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import Fastify from '../apps/server/node_modules/fastify/fastify.js';
import websocket from '../apps/server/node_modules/@fastify/websocket/index.js';
import WebSocket from '../apps/server/node_modules/ws/wrapper.mjs';
import {registerTerminal,type Session} from '../apps/server/src/terminal.ts';
import {registerSshRoutes} from '../apps/server/src/ssh-routes.ts';
import {displayCommand} from '../apps/server/src/ssh-command.ts';
import {previewKey} from '../apps/server/src/preview-access.ts';

test('SSH installs and reattaches to the Go worker over a private forward', {timeout: 45000}, async () => {
  const home = process.env.HOME!;
  const targetHome = process.env.REMOTEPAD2_TEST_SERVER_HOME!;
  const clientBin = process.env.REMOTEPAD2_TEST_CLIENT_BIN!;
  assert.ok(targetHome && clientBin, 'Run scripts/test-worker-ssh.sh to create the isolated fixture.');
  const host = 'rp2-go-test';
  const app = Fastify();
  let terminal: Session;
  let viewer: WebSocket | undefined;
  await app.register(websocket);
  const local = await registerTerminal(app);
  await registerSshRoutes(app, home, {create(options) {
    terminal = local.create(options);
    terminal.process.write('export PATH=' + displayCommand([clientBin]) + ':$PATH\r');
    return terminal;
  }});
  const url = await app.listen({host: '127.0.0.1', port: 0});

  async function connect() {
    const started = await fetch(url + '/api/ssh/connect', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({host}),
    });
    assert.equal(started.status, 200);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const status = await (await fetch(url + '/api/ssh/' + host + '/status')).json();
      if (status.connected) return;
      assert.notEqual(status.phase, 'Failed', status.error + '\n' + terminal.replay);
      await delay(100);
    }
    assert.fail('SSH did not connect:\n' + terminal.replay);
  }

  const proxy = url + '/api/ssh/' + host + '/proxy';
  try {
    await connect();
    const health = await (await fetch(proxy + '/health')).json();
    assert.equal(health.runtime, 'go');
    assert.equal(health.channel, 'dev');
    assert.equal((await (await fetch(proxy + '/files')).json()).path, targetHome);
    const created = await (await fetch(proxy + '/sessions', {method: 'POST'})).json();
    assert.equal(created.cwd, targetHome);
    assert.equal(created.alive, true);
    viewer = new WebSocket(url.replace('http:', 'ws:') + '/ws/ssh/' + host + '/terminal/' + created.id);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Remote PTY did not return shell output.')), 6000);
      let output = '';
      viewer!.on('message', (raw) => {
        const event = JSON.parse(String(raw));
        if (event.type === 'ready') {
          const file = targetHome + '/preview.txt';
          viewer!.send(JSON.stringify({
            type: 'input', data: "printf 'from-%s' go > " + displayCommand([file]) + "; cat " + displayCommand([file]) + "; echo\r",
          }));
        }
        if (event.type === 'output') output += event.data;
        if (/[\r\n]from-go[\r\n]/.test(output)) {
          clearTimeout(timeout);
          resolve();
        }
      });
      viewer!.once('error', (error) => { clearTimeout(timeout); reject(error); });
    });
    viewer.close();

    const preview = await fetch(proxy + '/preview/' + previewKey + targetHome + '/preview.txt');
    assert.equal(await preview.text(), 'from-go');
    assert.equal(preview.headers.get('content-security-policy'), 'sandbox allow-scripts allow-downloads');
    assert.equal((await fetch(proxy + '/preview/wrong' + targetHome + '/preview.txt')).status, 404);

    const disconnected = await fetch(url + '/api/ssh/disconnect', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({host}),
    });
    assert.equal(disconnected.status, 200);
    await connect();
    const reconnected = await (await fetch(proxy + '/health')).json();
    assert.equal(reconnected.pid, health.pid);
    const listed = await (await fetch(proxy + '/sessions')).json();
    assert.equal(listed.sessions.find((session: {id: string}) => session.id === created.id)?.alive, true);
    assert.equal((await fetch(proxy + '/sessions/' + created.id, {method: 'DELETE'})).status, 200);
  } finally {
    viewer?.terminate();
    await app.close();
  }
});
