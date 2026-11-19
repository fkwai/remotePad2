import { spawn } from 'node:child_process';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createGateway, channels } from '../../apps/server/src/gateway.ts';
const root=process.env.E2E_WORK_ROOT!;
const dir=path.join(root,'run'); await mkdir(dir,{recursive:true,mode:0o700});
const port=Number(process.env.REMOTEPAD2_PORT || 6220);
// All three run the checked-out source for routing tests, with distinct process/PTY identities.
const children=[];
for(const name of channels){
 const socket=path.join(dir,name+'.sock'); await unlink(socket).catch(()=>{});
 const child=spawn(process.execPath,['--import','tsx','src/index.ts'],{cwd:path.resolve('apps/server'),stdio:['ignore','ignore','inherit'],env:{...process.env,REMOTEPAD2_LOCAL_SOCKET:socket,REMOTEPAD2_WORKER_SOCKET:'',REMOTEPAD2_GATEWAY_PORT:String(port),REMOTEPAD2_CHANNEL:name}});
 children.push(child);
}
const {request}=await import('node:http');
for(const name of channels) {
 let ready=false;
 for(let attempt=0;attempt<100&&!ready;attempt++){
  ready=await new Promise<boolean>(resolve=>{const req=request({socketPath:path.join(dir,name+'.sock'),path:'/api/health',headers:{host:'127.0.0.1:'+port}},res=>{res.resume();resolve(res.statusCode===200)});req.on('error',()=>resolve(false));req.end();});
  if(!ready) await new Promise(resolve=>setTimeout(resolve,100));
 }
 if(!ready) throw new Error('Test backend not ready: '+name);
}
const server=createGateway({socket:name=>path.join(dir,name+'.sock'),statuses:async()=>({lanes:channels.map(name=>({name,alive:true,url:'/'+name+'/',phase:'Running'}))}),start:async()=>({running:true})});
server.listen(port,'127.0.0.1');
const close=()=>{server.closeAllConnections();server.close();for(const child of children)child.kill('SIGTERM');};
process.once('SIGTERM',close);process.once('SIGINT',close);
