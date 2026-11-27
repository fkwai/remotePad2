import os from 'node:os';
import path from 'node:path';
import {sessionLaunch} from './session-launch.ts';
import { randomUUID } from 'node:crypto';
import pty from 'node-pty';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { appOwner } from './codex-app.ts';
import { codexSessions } from './codex.ts';
import type { SessionInfo, SessionCreate, AgentKind, TerminalEvent } from '@remotepad2/protocol';

export interface Session {
  info: SessionInfo;
  process: pty.IPty;
  replay: string;
  clients: Set<WebSocket>;
}
export interface TerminalService {
  create(options?:{cwd?:string;name?:string;codexId?:string;kind?:SessionInfo['kind'];sshTarget?:string;agent?:AgentKind;project?:string;renamed?:boolean;executable?:string;args?:string[]}):Session;
}
export async function registerTerminal(app: FastifyInstance) {
  const sessions = new Map<string, Session>();
  const send = (socket: WebSocket, event: TerminalEvent) => {
    if (socket.readyState !== 1) return;
    // A slow viewer disconnects and can reconnect to the bounded replay.
    if (socket.bufferedAmount > 2 * 1024 * 1024) { socket.close(1013, 'Viewer too slow'); return; }
    socket.send(JSON.stringify(event));
  };
  app.addHook('onClose', async () => {
    for (const session of sessions.values()) if (session.info.alive) session.process.kill();
  });
  app.get('/api/sessions', async () => ({ sessions: [...sessions.values()].map((s) => s.info) }));
  app.get('/api/codex/sessions', async (_req, reply) => {
    try { return { sessions: codexSessions() }; }
    catch (error) { return reply.code(503).send({ error: (error as Error).message }); }
  });
  const create:TerminalService['create']=(options={})=>{
    const cwd = options.cwd || os.homedir();
    let process: pty.IPty;
    try {
      process = pty.spawn(options.executable || (options.codexId ? 'codex' : os.userInfo().shell || '/bin/bash'),
        options.args || (options.codexId ? ['resume', options.codexId, '--no-alt-screen'] : ['-l']), {
      name: 'xterm-256color', cols: 80, rows: 24, cwd,
      env: { ...globalThis.process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
    } catch (error) { throw error; }
    const session: Session = {
      info: { id: randomUUID(), name: options.name || 'Shell', cwd, codexId: options.codexId, kind:options.kind,sshTarget:options.sshTarget,agent:options.agent || (options.codexId?'codex':'shell'),project:options.project||path.basename(cwd)||cwd,machine:os.hostname(),createdAt:Date.now(),renamed:options.renamed,alive: true },
      process, replay: '', clients: new Set(),
    };
    sessions.set(session.info.id, session);
    process.onData((data) => {
      session.replay = (session.replay + data).slice(-200_000);
      for (const client of session.clients) send(client, { type: 'output', data });
    });
    process.onExit(({ exitCode }) => {
      session.info.alive = false;
      session.info.exitCode = exitCode;
      for (const client of session.clients) send(client, { type: 'exit', code: exitCode });
    });
    return session;
  };
  app.post<{ Body: SessionCreate }>('/api/sessions', async (req, reply) => {
    let launch:ReturnType<typeof sessionLaunch>;
    try{launch=sessionLaunch(req.body??{});}catch(error){return reply.code(400).send({error:(error as Error).message});}
    const codexId = req.body?.codexId;
    const attached = codexId ? [...sessions.values()].find((session) => session.info.codexId === codexId && session.info.alive) : undefined;
    const existing = codexId ? codexSessions().find((session) => session.id === codexId) : undefined;
    if (codexId && !existing) return reply.code(404).send({ error: 'Codex session unavailable.' });
    if (existing) {
      const owner = await appOwner(existing.id).catch(() => null);
      if (owner) return { id: 'app:' + existing.id, codexId: existing.id, kind: 'codex-app',
        name: existing.title, cwd: existing.cwd, agent:'codex',project:existing.project||path.basename(existing.cwd),machine:os.hostname(),createdAt:Date.now(),alive: true };
    }
    if (attached) return attached.info;
    try {return create({...launch,...(existing?{cwd:existing.cwd,name:req.body?.name?.trim()||existing.title,project:req.body?.project?.trim()||existing.project||path.basename(existing.cwd)}:{}),codexId:existing?.id}).info;}
    catch(error){return reply.code(400).send({error:(error as Error).message});}
  });
  app.patch<{Params:{id:string};Body:{name?:string}}>('/api/sessions/:id',async(req,reply)=>{
    const name=req.body?.name;
    if(typeof name!=='string'||!name.trim()||name.length>160||/[\0\r\n]/.test(name))return reply.code(400).send({error:'Enter a session name (up to 160 characters).'});
    const session=sessions.get(req.params.id);if(!session)return reply.code(404).send({error:'Session unavailable.'});
    session.info.name=name.trim();session.info.renamed=true;return session.info;
  });
  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req) => {
    const session = sessions.get(req.params.id);
    if (session) {
      if (session.info.alive) session.process.kill();
      for (const client of session.clients) client.close(1000, 'Session closed');
      sessions.delete(req.params.id);
    }
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>('/ws/terminal/:id', { websocket: true }, (socket, req) => {
    if (!req.headers.origin && !process.env.REMOTEPAD2_WORKER_SOCKET) { socket.close(1008, 'Browser origin required'); return; }
    const session = sessions.get(req.params.id);
    if (!session) { socket.close(1008, 'Session unavailable'); return; }
    session.clients.add(socket);
    send(socket, { type: 'ready', session: session.info, replay: session.replay });
    if (!session.info.alive) send(socket, { type: 'exit', code: session.info.exitCode || 0 });
    socket.on('message', (raw) => {
      if (!session.info.alive) return;
      try {
        const message = JSON.parse(String(raw));
        if (message.type === 'input' && typeof message.data === 'string' && message.data.length <= 65536) {
          session.process.write(message.data);
        } else if (message.type === 'resize' && Number.isInteger(message.cols) && Number.isInteger(message.rows)) {
          session.process.resize(Math.max(2, Math.min(500, message.cols)), Math.max(1, Math.min(300, message.rows)));
        }
      } catch { send(socket, { type: 'error', message: 'Invalid terminal message' }); }
    });
    socket.on('close', () => session.clients.delete(socket));
    socket.on('error', () => socket.close());
  });
  return {create} satisfies TerminalService;
}
