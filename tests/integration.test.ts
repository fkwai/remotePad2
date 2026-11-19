import { tempRoot } from './temp.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { CodexApp, patchState } from '../apps/server/src/codex-app.ts';
import { parseSsh } from '../apps/server/src/ssh.ts';

test('SSH input is parsed as arguments, never as a remote shell command', () => {
  assert.deepEqual(parseSsh('ssh -p 2222 -i "/path/key file" -J jump user@host'), {
    options: ['-p', '2222', '-i', '/path/key file', '-J', 'jump'], host: 'user@host',
  });
  for (const input of ['ssh host rm -rf /', 'ssh -o ProxyCommand=evil host', 'host;echo', 'ssh -p 99999 host']) {
    assert.throws(() => parseSsh(input));
  }
});

test('App follower subscribes and routes input to the original owner', async () => {
  const home = await mkdtemp(path.join(tempRoot, 'rp2-ipc-'));
  await mkdir(path.join(home, 'ipc'));
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  let sent = '';
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    const write = (message: unknown) => {
      const body = Buffer.from(JSON.stringify(message)), header = Buffer.alloc(4);
      header.writeUInt32LE(body.length); socket.write(Buffer.concat([header, body]));
    };
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE() + 4) {
        const length = buffer.readUInt32LE();
        const message = JSON.parse(buffer.subarray(4, length + 4).toString());
        buffer = buffer.subarray(length + 4);
        if (message.type === 'request') {
          if (message.method === 'thread-follower-start-turn') {
            assert.equal(message.targetClientId, 'app-owner');
            assert.equal(message.params.turnStart.request.threadId, 'thread-id');
            sent = message.params.turnStart.request.input[0].text;
          }
          write({ type: 'response', requestId: message.requestId, method: message.method,
            resultType: 'success', handledByClientId: 'app-owner', result: message.method === 'initialize' ? { clientId: 'rp-client' } : {} });
        } else if (message.method === 'thread-stream-following-changed' && message.params.following) {
          write({ type: 'broadcast', method: 'thread-stream-state-changed', version: 13,
            params: { hostId: 'local', conversationId: 'thread-id', change: { type: 'snapshot', revision: 1, conversationState: { turns: [] } } } });
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(path.join(home, 'ipc', 'ipc.sock'), resolve));
  const client = new CodexApp();
  try {
    const owner = await client.owner('thread-id');
    assert.equal(owner, 'app-owner');
    const update = new Promise<any>((resolve) => { client.onChange = resolve; });
    client.follow('thread-id', owner!, true);
    assert.equal((await update).change.type, 'snapshot');
    await client.send('thread-id', owner!, 'same-thread input');
    assert.equal(sent, 'same-thread input');
  } finally {
    client.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});

test('App incremental patches preserve array insertion and reject prototype paths', () => {
  const state = { turns: [{ text: 'a' }] };
  patchState(state, [{ op: 'add', path: ['turns', 1], value: { text: 'b' } },
    { op: 'replace', path: ['turns', 0, 'text'], value: 'changed' }]);
  assert.deepEqual(state.turns.map((turn) => turn.text), ['changed', 'b']);
  assert.throws(() => patchState(state, [{ op: 'replace', path: ['__proto__', 'x'], value: true }]));
});

test('Codex metadata prefers the user name and native project assignment', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { codexSessions } = await import('../apps/server/src/codex.ts');
  const home = await mkdtemp(path.join(tempRoot, 'rp2-codex-metadata-'));
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  try {
    const db = new DatabaseSync(path.join(home, 'state_5.sqlite'));
    db.exec(`CREATE TABLE threads(id TEXT,name TEXT,title TEXT,cwd TEXT,updated_at INT,archived INT,project_id TEXT);
      CREATE TABLE projects(id TEXT,name TEXT);
      CREATE TABLE project_roots(project_id TEXT,path TEXT,position INT);
      INSERT INTO projects VALUES('p1','My project');
      INSERT INTO threads VALUES('thread-1','My custom title','Original prompt','/repo',1,0,'p1');`);
    db.close();
    const rows = codexSessions();
    assert.equal(rows[0].title, 'My custom title');
    assert.equal(rows[0].project, 'My project');
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});
