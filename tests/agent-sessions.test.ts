import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,access} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import Fastify from '../apps/server/node_modules/fastify/fastify.js';
import websocket from '../apps/server/node_modules/@fastify/websocket/index.js';
import WebSocket from '../apps/server/node_modules/ws/wrapper.mjs';
import {registerTerminal} from '../apps/server/src/terminal.ts';
import {commandArguments} from '../apps/server/src/session-launch.ts';
import {displayCommand} from '../apps/server/src/ssh-command.ts';
import {tempRoot} from './temp.ts';

test('custom CLI argv preserves quoted values without evaluating shell expressions',()=>{
  assert.deepEqual(commandArguments(`tool "hello world" '' 'a;b' '\\$HOME'`),['tool','hello world','','a;b','\\$HOME']);
  assert.deepEqual(commandArguments(String.raw`tool "\d+" "a\qb" "\$HOME"`),['tool','\\d+','a\\qb','$HOME']);
  for(const input of ['',`tool "unclosed`,`tool\\`,`tool\nother`])assert.throws(()=>commandArguments(input));
});

test('managed agents share PTY lifecycle but retain independent metadata and names',async()=>{
  const root=await mkdtemp(path.join(tempRoot,'rp2-agent-sessions-'));
  const previousPath=process.env.PATH;
  const app=Fastify();const sockets:WebSocket[]=[];
  try {
    const bin=path.join(root,'bin');await mkdir(bin);
    for(const name of ['codex','claude','custom agent'])await writeFile(path.join(bin,name),`#!/bin/sh
printf 'FAKE_AGENT_READY:%s\\n' "$*"
while IFS= read -r input; do printf 'reply:%s\\n' "$input"; done
`,{mode:0o700});
    process.env.PATH=bin+path.delimiter+previousPath;
    await app.register(websocket);await registerTerminal(app);
    const origin=await app.listen({host:'127.0.0.1',port:0});
    const created=[];
    for(const agent of ['codex','claude','custom']){
      const sentinel=path.join(root,'must-not-exist');
      const command=displayCommand([path.join(bin,'custom agent'),'hello world','a;b','$(touch '+sentinel+')']);
      const response=await app.inject({method:'POST',url:'/api/sessions',payload:{agent,cwd:root,name:'Task '+agent,project:'Demo project',...(agent==='custom'?{command}:{})}});
      assert.equal(response.statusCode,200,response.body);const session=response.json();created.push(session);
      assert.equal(session.agent,agent);assert.equal(session.cwd,root);assert.equal(session.project,'Demo project');assert.ok(session.machine);assert.ok(session.createdAt);
      let output='';const socket=new WebSocket(origin.replace('http:','ws:')+'/ws/terminal/'+session.id,{headers:{origin}});sockets.push(socket);
      socket.on('message',raw=>{const event=JSON.parse(raw.toString());output+=event.replay||event.data||'';});
      const deadline=Date.now()+5000;while(!output.includes('FAKE_AGENT_READY:')){assert.ok(Date.now()<deadline,'CLI output timed out');await delay(25);}
      if(agent==='codex')assert.match(output,/--no-alt-screen/);
      if(agent==='custom'){assert.match(output,/hello world a;b \$\(touch/);await assert.rejects(access(sentinel));}
      socket.close();
      assert.equal((await app.inject('/api/sessions')).json().sessions.find((s:any)=>s.id===session.id).alive,true);
    }
    const renamed=await app.inject({method:'PATCH',url:'/api/sessions/'+created[0].id,payload:{name:'My task title'}});
    assert.equal(renamed.json().name,'My task title');assert.equal(renamed.json().renamed,true);assert.equal(renamed.json().alive,true);
    assert.equal((await app.inject({method:'PATCH',url:'/api/sessions/'+created[0].id,payload:{name:' '}})).statusCode,400);
    await app.inject({method:'DELETE',url:'/api/sessions/'+created[0].id});
    const remaining=(await app.inject('/api/sessions')).json().sessions;
    assert.equal(remaining.length,2);assert.ok(remaining.every((s:any)=>s.alive));
    for(const payload of [{agent:'unknown'},{agent:'custom',command:`tool "unclosed`},{cwd:path.join(root,'missing')},{agent:'claude',command:'echo unexpected'}]){
      assert.equal((await app.inject({method:'POST',url:'/api/sessions',payload})).statusCode,400);
    }
  }finally{
    for(const socket of sockets)socket.close();await app.close();
    if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;
    await rm(root,{recursive:true,force:true});
  }
});
