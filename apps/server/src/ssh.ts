import {remoteRuntime} from './ssh-runtime.ts';
import {displayCommand} from './ssh-command.ts';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {request} from 'node:http';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {sshDestination} from './ssh-hosts.ts';
import type {Session,TerminalService} from './terminal.ts';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const run=promisify(execFile);
const common=['-T','-o','StrictHostKeyChecking=ask','-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3'];
interface Transport {socket:string;control:string;input:string;dir:string;monitor?:NodeJS.Timeout}
const connections=new Map<string,Transport>();
const jobs=new Map<string,{session:Session;dir?:string;cancelled:boolean}>();
const pending=new Map<string,Promise<void>>();
const disconnects=new Map<string,Promise<void>>();
const progress=new Map<string,{phase:string;startedAt:number;error?:string}>();
function phase(input:string,value:string,error?:string){progress.set(input,{phase:value,startedAt:progress.get(input)?.startedAt||Date.now(),...(error?{error}:{})});}
export const sshProgress=(input:string)=>({...progress.get(input),terminal:jobs.get(input)?.session.info});
export const sshSocket=(input:string)=>connections.get(input)?.socket;
export const connectedHosts=()=>[...connections.keys()];
export function parseSsh(input: string): { options: string[]; host: string } {
  if (typeof input !== 'string' || input.length > 1024 || /[\r\n]/.test(input)) throw new Error('Enter an SSH host or ssh command.');
  const tokens = input.match(/"(?:[^"\\]|\\.)*"|'[^']*'|[^\s]+/g)?.map((x) => x.replace(/^["']|["']$/g, '')) || [];
  if (tokens[0] === 'ssh') tokens.shift();
  const options: string[] = [];
  while (tokens[0]?.startsWith('-')) {
    const flag = tokens.shift()!;
    if (!['-p', '-i', '-J'].includes(flag) || !tokens[0]) throw new Error('Supported SSH options: -p port, -i key, -J jump-host.');
    const value = tokens.shift()!;
    if (flag === '-p' && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)) throw new Error('Invalid SSH port.');
    if (value.startsWith('-')) throw new Error('Invalid SSH option value.');
    options.push(flag, value);
  }
  if (tokens.length !== 1 || !sshDestination.test(tokens[0])) throw new Error('Use a config alias or user@hostname. Remote commands are not accepted here.');
  return { options, host: tokens[0] };
}
export async function healthy(socketPath: string) {
  return new Promise<boolean>((resolve) => {
    const req = request({ socketPath, path: '/api/health', timeout: 5000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('timeout', () => req.destroy()); req.on('error', () => resolve(false)); req.end();
  });
}
async function stopTransport(transport:Transport,strict=false){
  const {options,host}=parseSsh(transport.input);
  try {await run('ssh',[...options,'-S',transport.control,'-O','exit','--',host],{timeout:3000});}
  catch(error){if(strict && await healthy(transport.socket))throw new Error('Could not stop SSH tunnel. Retry Disconnect.');}
  clearInterval(transport.monitor);
  await rm(transport.dir,{recursive:true,force:true});
}
async function waitCommand(result:string,job:{session:Session;cancelled:boolean}){
  const deadline=Date.now()+180000;
  for(;;){
    if(job.cancelled || !job.session.info.alive)throw new Error('Connection terminal was closed.');
    const code=await readFile(result,'utf8').catch(()=>null);
    if(code!==null){if(code.trim()!=='0')throw new Error('SSH setup command exited with code '+code.trim()+'. See terminal output.');return;}
    if(Date.now()>deadline){job.session.process.write('\x03');throw new Error('SSH setup timed out. See terminal output.');}
    await delay(200);
  }
}
async function connect(input:string,job:{session:Session;dir?:string;cancelled:boolean}){
  const {options,host}=parseSsh(input);
  let transport:Transport|undefined;
  try {
    phase(input,'Packaging backend');
    const dir=await mkdtemp('/tmp/rp2-prepare-');job.dir=dir;
    const archive=dir+'/backend.tar',packed=dir+'/packed',packScript=dir+'/package.sh';
    const packageFiles=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','apps/server/src','apps/server/scripts','apps/server/package.json','apps/server/tsconfig.json','packages/protocol'];
    await writeFile(packScript,`#!/bin/bash
umask 077
set -eu
# Bash 5 may report zero to EXIT after SIGINT unless the signal is handled.
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'code=$?; printf "%s\\n" "$code" > ${displayCommand([packed])}' EXIT
export COPYFILE_DISABLE=1
${displayCommand(['tar','-cf',archive,'-C',root,...packageFiles])}
`,{mode:0o700});
    if(job.cancelled || !job.session.info.alive)throw new Error('Connection terminal was closed.');
    job.session.process.write(displayCommand(['/bin/bash','-x',packScript])+'\r');
    await waitCommand(packed,job);
    if((await stat(archive)).size>32*1024*1024)throw new Error('Backend bundle exceeds 32 MB.');
    const bundle=await readFile(archive);
    const revision=createHash('sha256').update(bundle).digest('hex').slice(0,20);
    const runtime=remoteRuntime(revision);
    const install=`"$HOME/${runtime.install}"`;
    const bootstrap=`
    set -eux
    umask 077
    echo REMOTEPAD2_PHASE=Checking\ remote\ backend >&2
    export PATH="$HOME/.local/bin:$HOME/.local/share/pnpm:/opt/homebrew/bin:/usr/local/bin:$PATH"
    command -v node >/dev/null || { echo 'Node.js 22+ is required in non-interactive SSH PATH.' >&2; exit 1; }
    node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' || { echo 'Node.js 22+ is required.' >&2; exit 1; }
    mkdir -p "$HOME/.remotepad2/backend/${runtime.channel}"
    if ! test -f ${install}/.ready; then
      echo REMOTEPAD2_PHASE=Installing\ backend\ dependencies >&2
      stage=$(mktemp -d "$HOME/.remotepad2/backend/${runtime.channel}/.install.XXXXXXXX")
      trap 'rm -rf "$stage"' EXIT
      tar -xf - -C "$stage"
      pnpm_version=$(node -e 'const p=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).packageManager;if(!/^pnpm@[0-9]+[.][0-9]+[.][0-9]+$/.test(p))throw Error("Invalid pnpm version");console.log(p.slice(5))' "$stage/package.json")
      tools="$HOME/.remotepad2/tools/pnpm-$pnpm_version"
      if command -v pnpm >/dev/null && test "$(pnpm --version)" = "$pnpm_version"; then
        pnpm_bin=$(command -v pnpm)
      else
        command -v npm >/dev/null || { echo 'npm is needed to prepare the RemotePad2 package manager.' >&2; exit 1; }
        if ! test -f "$tools/node_modules/pnpm/bin/pnpm.cjs"; then
          npm install --prefix "$tools" --no-audit --no-fund --ignore-scripts "pnpm@$pnpm_version" >&2
        fi
        pnpm_bin="$tools/node_modules/pnpm/bin/pnpm.cjs"
      fi
      (cd "$stage" && "$pnpm_bin" --filter @remotepad2/server... install --frozen-lockfile) >&2
      touch "$stage/.ready"
      node -e 'require("node:fs").renameSync(process.argv[1],process.argv[2])' "$stage" ${install} || test -f ${install}/.ready
    else
      echo REMOTEPAD2_PHASE=Reusing\ installed\ backend >&2
      cat >/dev/null
    fi
    echo REMOTEPAD2_PHASE=Starting\ remote\ backend >&2
    export REMOTEPAD2_CHANNEL=${runtime.channel}
    socketdir="${runtime.socketDirectory}"
    mkdir -p "$socketdir"
    chmod 700 "$socketdir"
    export REMOTEPAD2_WORKER_SOCKET="$socketdir/api.sock"
    if ! node -e 'const q=require("node:http").get({socketPath:process.env.REMOTEPAD2_WORKER_SOCKET,path:"/api/health"},r=>{r.resume();process.exit(r.statusCode===200?0:1)});q.on("error",()=>process.exit(1));q.setTimeout(1000,()=>process.exit(1))'; then
      if mkdir "$socketdir/start.lock" 2>/dev/null; then
        trap 'rmdir "$socketdir/start.lock"' EXIT
        cd ${install}/apps/server
        nohup node --import tsx src/index.ts >"$socketdir/backend.log" 2>&1 </dev/null &
        for attempt in 1 2 3 4 5 6 7 8 9 10; do test -S "$REMOTEPAD2_WORKER_SOCKET" && break; sleep 1; done
      fi
    fi
    printf '\\nREMOTEPAD2_UID=%s\\n' "$(id -u)"
`;
    const tunnel=await mkdtemp('/tmp/rp2-ssh-');
    transport={input,dir:tunnel,socket:tunnel+'/api.sock',control:tunnel+'/control.sock'};
    const output=dir+'/bootstrap.out',result=dir+'/result',script=dir+'/connect.sh';
    const ssh=displayCommand(['ssh',...common,...options,'-o','ControlMaster=no','-o','ControlPath=none','-o','ClearAllForwardings=yes','--',host,bootstrap]);
    const master=displayCommand(['ssh',...common,...options,'-M','-S',transport.control,'-f','-N','-o','ExitOnForwardFailure=yes','-L']);
    // bash -x runs in the ordinary PTY: commands, raw output and /dev/tty auth
    // all use the same interactive terminal. The authenticated master detaches.
    await writeFile(script,`#!/bin/bash
umask 077
set -euo pipefail
# Bash 5 may report zero to EXIT after SIGINT unless the signal is handled.
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'code=$?; printf "%s\\n" "$code" > ${displayCommand([result])}' EXIT
${ssh} < ${displayCommand([archive])} | tee ${displayCommand([output])}
uid=$(sed -n 's/^REMOTEPAD2_UID=\\([0-9]*\\)$/\\1/p' ${displayCommand([output])} | tail -1)
test -n "$uid"
${master} "${transport.socket}:${runtime.socketDirectory.replace('$(id -u)','$uid')}/api.sock" -- ${displayCommand([host])}
`,{mode:0o700});
    if(job.cancelled || !job.session.info.alive)throw new Error('Connection terminal was closed.');
    phase(input,'SSH login');
    let lines='';
    const watcher=job.session.process.onData(data=>{
      lines+=data;const complete=lines.split('\n');lines=complete.pop()?.slice(-4096)||'';
      for(const line of complete){const match=line.match(/^REMOTEPAD2_PHASE=([^\r\n]+)/);if(match)phase(input,match[1]);}
    });
    job.session.process.write(displayCommand(['/bin/bash','-x',script])+'\r');
    try {await waitCommand(result,job);} finally {watcher.dispose();}
    phase(input,'Waiting for tunnel health');
    const healthDeadline=Date.now()+30000;
    while(Date.now()<healthDeadline){
      if(job.cancelled)throw new Error('Connection cancelled.');
      if(await healthy(transport.socket)){
        const ready=transport;connections.set(input,ready);phase(input,'Connected');
        let checking=false,failures=0;
        ready.monitor=setInterval(()=>{
          if(checking)return;checking=true;
          void healthy(ready.socket).then(ok=>{failures=ok?0:failures+1;if(failures>=3 && connections.get(input)===ready){connections.delete(input);phase(input,'Disconnected');void stopTransport(ready);}}).finally(()=>{checking=false;});
        },15000);ready.monitor.unref();
        return;
      }
      await delay(250);
    }
    throw new Error('SSH tunnel health check timed out. See terminal output.');
  } catch(error){if(transport)await stopTransport(transport);if(!job.session.info.alive && job.dir)await rm(job.dir,{recursive:true,force:true});throw error;}
}
export function connectSsh(input:string,terminals:TerminalService){
  parseSsh(input);
  if(disconnects.has(input))throw new Error('SSH is disconnecting. Retry when finished.');
  if(connections.has(input))return {connected:true,terminal:jobs.get(input)?.session.info};
  if(pending.has(input))return {connected:false,terminal:jobs.get(input)!.session.info};
  const session=terminals.create({name:'SSH · '+input,kind:'ssh-connect',sshTarget:input});
  const job={session,cancelled:false,dir:undefined as string|undefined};jobs.set(input,job);
  progress.delete(input);phase(input,'Preparing connection terminal');
  session.process.onExit(()=>{if(job.dir)void rm(job.dir,{recursive:true,force:true});});
  const task=connect(input,job).catch(error=>phase(input,'Failed',error.message)).finally(()=>pending.delete(input));
  pending.set(input,task);
  return {connected:false,terminal:session.info};
}
export function disconnectSsh(input:string){
  parseSsh(input);
  if(disconnects.has(input))return disconnects.get(input)!;
  const task=(async()=>{
    phase(input,'Disconnecting');
    const job=jobs.get(input),preparing=pending.get(input);
    if(preparing && job){job.cancelled=true;if(job.session.info.alive)job.session.process.write('\x03');await preparing;}
    const transport=connections.get(input);
    try {
      if(transport){await stopTransport(transport,true);if(connections.get(input)===transport)connections.delete(input);}
      phase(input,'Disconnected');
    } catch(error){phase(input,'Connected',(error as Error).message);throw error;}
  })().finally(()=>disconnects.delete(input));
  disconnects.set(input,task);return task;
}
export async function closeSsh(){
  for(const [input,job] of jobs){job.cancelled=true;if(pending.has(input)&&job.session.info.alive)job.session.process.write('\x03');}
  await Promise.all([...pending.values()]);
  await Promise.allSettled([...disconnects.values()]);
  const transports=[...connections.values()];connections.clear();
  await Promise.all(transports.map(transport=>stopTransport(transport)));
}
