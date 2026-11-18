import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { sshDestination } from './ssh-hosts.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const run = promisify(execFile);
const common = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
  '-o', 'ConnectTimeout=10', '-o', 'ControlMaster=no', '-o', 'ControlPath=none',
  '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'];
const connections = new Map<string, { socket: string; child: ChildProcess }>();
const pending = new Map<string, Promise<void>>();

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
function execSsh(input: string, command: string, body?: Buffer) {
  const { options, host } = parseSsh(input);
  return new Promise<void>((resolve, reject) => {
    const child = execFile('ssh', [...common, ...options, '-o', 'ClearAllForwardings=yes', '--', host, command],
      { timeout: 180000, maxBuffer: 1024 * 1024 }, (error, _stdout, stderr) =>
        error ? reject(new Error(stderr.trim().slice(-1800) || error.message)) : resolve());
    child.stdin?.on('error', () => {});
    child.stdin?.end(body);
  });
}
export const sshSocket = (host: string) => connections.get(host)?.socket;
export const connectedHosts = () => [...connections.keys()];
async function healthy(socketPath: string) {
  return new Promise<boolean>((resolve) => {
    const req = request({ socketPath, path: '/api/health', timeout: 500 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('timeout', () => req.destroy()); req.on('error', () => resolve(false)); req.end();
  });
}
async function connect(input: string) {
  const { options, host } = parseSsh(input);
  const { stdout: bundle } = await run('tar', ['-cf', '-', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json',
    'apps/server/src', 'apps/server/scripts', 'apps/server/package.json', 'apps/server/tsconfig.json',
    'packages/protocol'], { cwd: root, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const revision = createHash('sha256').update(bundle).digest('hex').slice(0, 20);
  const install = `"$HOME/.remotepad2/backend/${revision}"`;
  // A versioned backend survives the transport. Reconnecting reuses its PTYs.
  await execSsh(input, `
    set -eu
    umask 077
    export PATH="$HOME/.local/bin:$HOME/.local/share/pnpm:/opt/homebrew/bin:/usr/local/bin:$PATH"
    command -v node >/dev/null || { echo 'Node.js 22+ is required in non-interactive SSH PATH.' >&2; exit 1; }
    node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' || { echo 'Node.js 22+ is required.' >&2; exit 1; }
    mkdir -p "$HOME/.remotepad2/backend"
    if ! test -f ${install}/.ready; then
      stage=$(mktemp -d "$HOME/.remotepad2/backend/.install.XXXXXXXX")
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
      cat >/dev/null
    fi
    socketdir="/tmp/rp2-$(id -u)-${revision}"
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
  `, bundle);
  const dir = await mkdtemp('/tmp/rp2-ssh-');
  const socket = dir + '/api.sock';
  const remoteSocket = `/tmp/rp2-$(id -u)-${revision}/api.sock`;
  // Resolve UID separately. Do not interpret user-supplied input in a shell.
  const uid = await run('ssh', [...common, ...options, '-o', 'ClearAllForwardings=yes', '--', host, 'id -u'], { timeout: 15000 });
  if (!/^\d+$/.test(uid.stdout.trim())) throw new Error('Could not resolve remote user.');
  const remote = remoteSocket.replace('$(id -u)', uid.stdout.trim());
  const child = spawn('ssh', [...common, ...options, '-N', '-o', 'ExitOnForwardFailure=yes', '-L', `${socket}:${remote}`, '--', host], { stdio: ['ignore', 'ignore', 'pipe'] });
  let failure = '', ended = false;
  child.stderr.on('data', (data) => { failure = (failure + data).slice(-1500); });
  child.on('error', (error) => { failure = error.message; ended = true; });
  child.once('close', () => { ended = true; if (connections.get(input)?.child === child) connections.delete(input); void rm(dir, { recursive: true, force: true }); });
  for (let i = 0; i < 60 && !ended; i++) {
    if (await healthy(socket)) { connections.set(input, { socket, child }); return; }
    await delay(250);
  }
  child.kill();
  throw new Error(failure.trim() || 'Remote backend did not start.');
}
export function connectSsh(input: string) {
  parseSsh(input);
  if (connections.has(input)) return Promise.resolve();
  if (pending.has(input)) return pending.get(input)!;
  const task = connect(input).finally(() => pending.delete(input));
  pending.set(input, task);
  return task;
}
export function closeSsh() { for (const connection of connections.values()) connection.child.kill(); }
