import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import Fastify from '../apps/server/node_modules/fastify/fastify.js';
import websocket from '../apps/server/node_modules/@fastify/websocket/index.js';
import {registerSshRoutes} from '../apps/server/src/ssh-routes.ts';
import {savedMachines} from '../apps/server/src/ssh-machines.ts';
import {tempRoot} from './temp.ts';

test('SSH destinations persist separately from config; invalid commands and cross-origin writes fail',async()=>{
  const home=await mkdtemp(path.join(tempRoot,'rp2-machines-'));
  const app=Fastify();
  const headers={host:'127.0.0.1:6020'};
  const config='Host my-cloud\n  HostName example.invalid\n';
  try {
    await mkdir(path.join(home,'.ssh'));
    await writeFile(path.join(home,'.ssh/config'),config);
    await app.register(websocket);await registerSshRoutes(app,home);
    const call=(method:'GET'|'POST'|'DELETE',url:string,payload?:object)=>app.inject({method,url,headers,remoteAddress:'127.0.0.1',...(payload?{payload}:{})});
    const saved=await call('POST','/api/ssh/machines',{command:' ssh -J jump user@my-cloud ',name:'Cloud'});
    assert.equal(saved.statusCode,200);
    const machine=saved.json();assert.equal(machine.command,'ssh -J jump user@my-cloud');
    const list=(await call('GET','/api/ssh/hosts')).json();assert.deepEqual(list.hosts,['my-cloud']);assert.deepEqual(list.saved,[machine]);
    assert.deepEqual(savedMachines(home).read(),[machine]);
    const duplicate=await call('POST','/api/ssh/machines',{command:machine.command,name:'Renamed'});
    assert.equal(duplicate.json().id,machine.id);assert.equal(savedMachines(home).read().length,1);
    for(const command of ['host;rm -rf /','ssh host command','ssh -o ProxyCommand=evil host',''])assert.equal((await call('POST','/api/ssh/machines',{command})).statusCode,400);
    const forbidden=await app.inject({method:'POST',url:'/api/ssh/machines',remoteAddress:'127.0.0.1',headers:{...headers,origin:'https://untrusted.example'},payload:{command:'my-cloud'}});
    assert.equal(forbidden.statusCode,403);
    await call('DELETE','/api/ssh/machines/'+machine.id);
    assert.deepEqual(savedMachines(home).read(),[]);
    assert.equal(await readFile(path.join(home,'.ssh/config'),'utf8'),config);
    assert.deepEqual((await call('GET','/api/ssh/hosts')).json().connected,[]);
  } finally {await app.close();await rm(home,{recursive:true,force:true});}
});
