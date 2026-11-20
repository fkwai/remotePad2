import {test} from 'node:test';
import assert from 'node:assert/strict';
import {displayCommand} from '../apps/server/src/ssh-command.ts';
import {remoteRuntime} from '../apps/server/src/ssh-runtime.ts';

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
