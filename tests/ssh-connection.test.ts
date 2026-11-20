import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ConnectionLog, displayCommand} from '../apps/server/src/ssh-log.ts';
import {remoteRuntime} from '../apps/server/src/ssh-runtime.ts';

test('connection transcript is incremental, bounded in bytes and redacts credentials', () => {
  const log = new ConnectionLog(100);
  log.write('starting\r\n');
  const first = log.read();
  log.write('ssh ready\r\n');
  assert.deepEqual(log.read(first.nextSeq).logs.map(x=>x.text), ['ssh ready\r\n']);
  log.write('汉'.repeat(100));
  const remaining = log.read().logs.map(x=>x.text).join('');
  assert.ok(Buffer.byteLength(remaining)<=100);
  assert.ok(!remaining.includes('\ufffd'));
  const secrets = new ConnectionLog();
  secrets.write('Authorization: Bearer private-secret\npassword=pwd token=abc https://user:pass@registry.example/fail');
  assert.doesNotMatch(secrets.read().logs[0].text, /private-secret|pwd|abc|user:pass/);
  assert.notEqual(log.runId, secrets.runId);
  assert.equal(log.read(999).logs.length,0);
});

test('remote lanes cannot share workers even at the same revision', () => {
  const revision='abcdef0123456789abcd';
  const runtimes=['main','dev','nightly'].map(lane=>remoteRuntime(revision,lane));
  assert.equal(new Set(runtimes.map(x=>x.socketDirectory)).size,3);
  assert.equal(new Set(runtimes.map(x=>x.install)).size,3);
  assert.equal(remoteRuntime('0123456789abcdef0123','dev').channel,'dev');
  assert.throws(()=>remoteRuntime(revision,'dev; command'));
  assert.throws(()=>remoteRuntime('../path','dev'));
});

test('diagnostic command display preserves arguments with spaces and quotes', () => {
  assert.equal(displayCommand(['ssh','-i',"/key's path",'host']), `ssh -i '/key'"'"'s path' host`);
});
