import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tempRoot } from './temp.ts';
import WebSocket, { WebSocketServer } from '../apps/server/node_modules/ws/wrapper.mjs';
import { channelPath, createGateway } from '../apps/server/src/gateway.ts';

test('gateway selects a lane without mixing prefixes and preserves queries', () => {
  assert.deepEqual(channelPath('/dev/api/files?path=%2Froot'), {channel:'dev',path:'/api/files?path=%2Froot'});
  assert.deepEqual(channelPath('/nightly?w=test'),{channel:'nightly',path:'/?w=test'});
  for (const url of ['/developer/', '/unknown/', '//dev/', '/api/files']) assert.equal(channelPath(url),undefined);
});
test('one gateway routes HTTP, local SSH metadata and WebSockets to private sockets', async () => {
  const root=await mkdtemp(path.join(tempRoot,'rp2-gw-'));
  const socket=path.join(root,'api.sock');
  const backend=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({url:req.url,host:req.headers.host}));});
  const websocket=new WebSocketServer({server:backend});
  websocket.on('connection',ws=>ws.on('message',message=>ws.send(message)));
  await new Promise<void>(resolve=>backend.listen(socket,resolve));
  let started='';
  const gateway=createGateway({socket:()=>socket,statuses:async()=>({lanes:[]}),start:async name=>{started=name;return {starting:true}}});
  await new Promise<void>(resolve=>gateway.listen(0,'127.0.0.1',resolve));
  const address=gateway.address() as {port:number}; const base='http://127.0.0.1:'+address.port;
  try {
    const response=await fetch(base+'/dev/api/files?path=%2Froot');
    assert.equal(response.status,200); assert.equal((await response.json()).url,'/api/files?path=%2Froot');
    const alias=await(await fetch(base+'/nightly/api/ssh/hosts')).json(); assert.equal(alias.url,'/api/ssh/hosts');
    assert.equal((await fetch(base+'/dev?w=one',{redirect:'manual'})).headers.get('location'),'/dev/?w=one');
    assert.equal((await fetch(base+'/?w=one',{redirect:'manual'})).headers.get('location'),'/main/?w=one');
    assert.equal((await fetch(base+'/dev/api/files',{headers:{origin:'https://untrusted.invalid'}})).status,403);
    assert.equal((await fetch(base+'/_gateway/lanes/dev/start',{method:'POST'})).status,202); assert.equal(started,'dev');
    const ws=new WebSocket('ws://127.0.0.1:'+address.port+'/dev/ws/terminal/test',{origin:base});
    await new Promise<void>((resolve,reject)=>{ws.once('error',reject);ws.once('open',()=>ws.send('terminal-through-gateway'));ws.once('message',data=>{assert.equal(data.toString(),'terminal-through-gateway');resolve()});});
    ws.close(); await new Promise<void>(resolve=>ws.once('close',()=>resolve()));
  } finally {
    gateway.closeAllConnections(); await new Promise<void>(resolve=>gateway.close(()=>resolve()));
    websocket.close(); backend.closeAllConnections(); await new Promise<void>(resolve=>backend.close(()=>resolve()));
    await rm(root,{recursive:true,force:true});
  }
});
