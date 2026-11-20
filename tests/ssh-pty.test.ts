import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import Fastify from '../apps/server/node_modules/fastify/fastify.js';
import websocket from '../apps/server/node_modules/@fastify/websocket/index.js';
import {registerTerminal,type Session,type TerminalService} from '../apps/server/src/terminal.ts';
import {connectSsh,disconnectSsh,sshProgress,closeSsh} from '../apps/server/src/ssh.ts';
import {displayCommand} from '../apps/server/src/ssh-command.ts';
import {tempRoot} from './temp.ts';

async function until(check:()=>boolean) {
  const deadline=Date.now()+10000;
  while(!check()){if(Date.now()>deadline)throw new Error('PTY condition timed out');await delay(50);}
}
test('SSH runs in an interactive PTY: auth input, original stderr, failure and Ctrl+C', {timeout:25000},async()=>{
  const home=await mkdtemp(path.join(tempRoot,'rp2-ssh-pty-'));
  const before=process.env.HOME;process.env.HOME=home;
  const app=Fastify();
  let current:Session;
  try {
    const bin=path.join(home,'bin');await mkdir(bin);
    // Deliberately fail after reading /dev/tty. No test contacts a remote host.
    await writeFile(path.join(bin,'ssh'),`#!/bin/bash
printf 'Test SSH authentication: ' > /dev/tty
IFS= read -r answer < /dev/tty
printf '\\nOriginal SSH stderr after interactive input\\n' >&2
exit 42
`,{mode:0o700});
    await app.register(websocket);const terminals=await registerTerminal(app);
    const service:TerminalService={create(options){
      current=terminals.create(options);
      current.process.write('export PATH='+displayCommand([bin])+':$PATH\r');
      return current;
    }};
    const started=connectSsh('pty-test-host',service);
    assert.equal(started.terminal?.id,current!.info.id);
    await until(()=>current.replay.includes('Test SSH authentication: '));
    assert.match(current!.replay,/\+ ssh /);
    assert.equal(sshProgress('pty-test-host').terminal?.alive,true);
    current!.process.write('approved\r');
    await until(()=>sshProgress('pty-test-host').phase==='Failed');
    assert.match(current!.replay,/Original SSH stderr after interactive input/);
    assert.match(sshProgress('pty-test-host').error!,/42/);
    current!.process.write("printf 'after-ssh-%s\\n' works\r");
    await until(()=>current.replay.includes('after-ssh-works'));
    assert.equal(current!.info.alive,true);
    connectSsh('pty-cancel-host',service);
    await until(()=>current.replay.includes('Test SSH authentication: '));
    current!.process.write('\x03');
    await until(()=>sshProgress('pty-cancel-host').phase==='Failed');
    assert.equal(current!.info.alive,true);
    connectSsh('pty-disconnect-host',service);
    await until(()=>current.replay.includes('Test SSH authentication: '));
    await disconnectSsh('pty-disconnect-host');
    assert.equal(sshProgress('pty-disconnect-host').phase,'Disconnected');
    assert.equal(current!.info.alive,true);
    assert.equal(sshProgress('pty-test-host').phase,'Failed');
  } finally {
    await closeSsh();await app.close();
    if(before===undefined)delete process.env.HOME;else process.env.HOME=before;
    await rm(home,{recursive:true,force:true});
  }
});
