import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, unlink, open } from 'node:fs/promises';
import { request } from 'node:http';
import { channels, type Channel } from './gateway.ts';
const run = promisify(execFile);
export const repo = fileURLToPath(new URL('../../../', import.meta.url));
export const runtimeDir = process.env.REMOTEPAD2_RUN_DIR || path.join(os.homedir(), '.remotepad2/run');
const checkoutDir = process.env.REMOTEPAD2_LANES_DIR || path.join(os.homedir(), 'work/remotepad2-lanes');
export const socketFor = (channel: Channel) => path.join(runtimeDir, channel + '.sock');
const metaFile = (channel: Channel) => path.join(runtimeDir, channel + '.json');
async function metadata(channel: Channel) { try { return JSON.parse(await readFile(metaFile(channel), 'utf8')); } catch { return {}; } }
export async function laneAlive(channel: Channel, port: number) {
  return new Promise<boolean>((resolve) => {
    const req = request({ socketPath: socketFor(channel), path: '/api/health', headers: { host: '127.0.0.1:' + port }, timeout: 1500 }, (reply) => { reply.resume(); resolve(reply.statusCode === 200); });
    req.on('timeout', () => req.destroy()); req.on('error', () => resolve(false)); req.end();
  });
}
export async function laneStatuses(port: number) {
  return { lanes: await Promise.all(channels.map(async (name) => ({ name, ...await metadata(name), alive: await laneAlive(name, port), url: '/' + name + '/' }))) };
}
async function prepare(channel: Channel) {
  if (channel === 'dev') {
    const branch = (await run('git', ['-C', repo, 'branch', '--show-current'])).stdout.trim();
    if (branch !== 'dev') throw new Error('Start dev from the dev checkout. The launcher never switches your working branch.');
    return repo;
  }
  const checkout = path.join(checkoutDir, channel);
  await mkdir(checkoutDir, { recursive: true });
  const ref = 'refs/remotes/origin/' + channel;
  await run('git', ['-C', repo, 'fetch', 'origin', 'refs/heads/' + channel + ':' + ref], { timeout: 60000 });
  // Per-channel refs avoid races when two lane starts fetch concurrently.
  const sha = (await run('git', ['-C', repo, 'rev-parse', ref])).stdout.trim();
  try { await readFile(path.join(checkout, '.git')); }
  catch { await run('git', ['-C', repo, 'worktree', 'add', '--detach', checkout, sha], { timeout: 15000 }); return checkout; }
  const changes = (await run('git', ['-C', checkout, 'status', '--porcelain'])).stdout.trim();
  if (changes) throw new Error(checkout + ' has local changes; refusing to overwrite it.');
  await run('git', ['-C', checkout, 'checkout', '--detach', sha], { timeout: 15000 });
  return checkout;
}
const starting = new Map<Channel, Promise<void>>();
export async function startLane(channel: Channel, port: number) {
  if (await laneAlive(channel, port)) return { running: true };
  if (starting.has(channel)) return { starting: true };
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  // mkdir is a cross-process lock; different CLI invocations cannot rebuild one lane together.
  const lock = path.join(runtimeDir, channel + '.lock');
  await mkdir(lock).catch(() => { throw new Error(channel + ' is already starting (or has a stale lock at ' + lock + ').'); });
  const baseline = await metadata(channel);
  const set = (data: object) => writeFile(metaFile(channel), JSON.stringify({ ...baseline, error: undefined, ...data }), { mode: 0o600 });
  const task = (async () => {
    await set({ phase: 'Preparing checkout' });
    const cwd = await prepare(channel);
    await set({ phase: 'Installing and building', cwd });
    const log = await open(path.join(runtimeDir, channel + '.log'), 'a', 0o600);
    try {
      const command = (args: string[]) => new Promise<void>((resolve, reject) => {
        const child = spawn('pnpm', args, { cwd, stdio: ['ignore', log.fd, log.fd], env: { ...process.env, REMOTEPAD2_WORKER_SOCKET: '', REMOTEPAD2_LOCAL_SOCKET: '' } });
        child.on('error', reject); child.on('close', (code) => code === 0 ? resolve() : reject(new Error('pnpm ' + args.join(' ') + ' failed; see ' + runtimeDir + '/' + channel + '.log')));
      });
      await command(['install', '--frozen-lockfile']); await command(['build']);
      const previous = await metadata(channel);
      if (previous.pid) { try { process.kill(previous.pid, 0); throw new Error('A previous process still owns this lane; stop it explicitly.'); } catch (error: any) { if (error.code !== 'ESRCH') throw error; } }
      await unlink(socketFor(channel)).catch(() => {});
      const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
        cwd: path.join(cwd, 'apps/server'), detached: true, stdio: ['ignore', log.fd, log.fd],
        env: { ...process.env, REMOTEPAD2_WORKER_SOCKET: '', REMOTEPAD2_LOCAL_SOCKET: socketFor(channel), REMOTEPAD2_GATEWAY_PORT: String(port), REMOTEPAD2_CHANNEL: channel },
      });
      child.unref();
      child.on('error', () => {});
      const commit = (await run('git', ['-C', cwd, 'rev-parse', '--short', 'HEAD'])).stdout.trim();
      await set({ pid: child.pid, cwd, commit, phase: 'Starting', started: Date.now() });
      for (let attempt = 0; attempt < 50; attempt++) {
        if (await laneAlive(channel, port)) { await set({ pid: child.pid, cwd, commit, phase: 'Running', started: Date.now() }); return; }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error('Lane did not become ready; see ' + runtimeDir + '/' + channel + '.log');
    } finally { await log.close(); }
  })().catch(async (error) => { const previous = await metadata(channel); await set({ ...previous, phase: 'Failed', error: error.message }); throw error; }).finally(async () => {
    starting.delete(channel); const { rmdir } = await import('node:fs/promises'); await rmdir(lock).catch(() => {});
  });
  starting.set(channel, task);
  // API returns promptly; callers poll phases. Errors are retained in metadata.
  void task.catch(() => {});
  return { starting: true };
}
export async function waitForLane(channel: Channel) { await starting.get(channel); }
export async function stopLane(channel: Channel, port: number) {
  const meta = await metadata(channel);
  if (meta.pid) {
    let exists = true; try { process.kill(meta.pid, 0); } catch (error: any) { if (error.code === 'ESRCH') exists = false; else throw error; }
    if (exists) {
      const identity = await new Promise<number | undefined>((resolve) => {
        const req = request({socketPath:socketFor(channel),path:'/api/health',headers:{host:'127.0.0.1:' + port},timeout:1500}, reply => {
          let body = ''; reply.on('data', chunk => body += chunk); reply.on('end', () => { try { resolve(JSON.parse(body).pid); } catch { resolve(undefined); } });
        }); req.on('error',()=>resolve(undefined)); req.on('timeout',()=>req.destroy()); req.end();
      });
      if (identity !== meta.pid) throw new Error('Could not verify lane process identity; no process was stopped.');
      process.kill(meta.pid, 'SIGTERM');
    }
  }
  await writeFile(metaFile(channel), JSON.stringify({ ...meta, phase: 'Stopped' }), { mode: 0o600 });
}
