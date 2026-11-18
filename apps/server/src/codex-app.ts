import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

type RecordValue = Record<string, any>;
export class CodexApp {
  private socket: net.Socket;
  private buffer = Buffer.alloc(0);
  private clientId = 'initializing-client';
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private initialized: Promise<void>;
  onChange?: (params: RecordValue) => void;
  onClose?: () => void;
  constructor() {
    this.socket = net.connect(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'ipc', 'ipc.sock'));
    this.socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (this.buffer.length >= 4) {
        const length = this.buffer.readUInt32LE();
        if (length > 32 * 1024 * 1024) { this.socket.destroy(new Error('Codex frame too large')); return; }
        if (this.buffer.length < length + 4) break;
        try { this.receive(JSON.parse(this.buffer.subarray(4, length + 4).toString())); }
        catch { this.socket.destroy(); return; }
        this.buffer = this.buffer.subarray(length + 4);
      }
    });
    this.socket.on('error', () => {});
    this.socket.on('close', () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer); request.reject(new Error('Codex App connection closed'));
      }
      this.pending.clear();
      this.onClose?.();
    });
    this.initialized = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.socket.destroy(); reject(new Error('Codex App unavailable')); }, 5000);
      this.socket.once('error', (error) => { clearTimeout(timer); reject(error); });
      this.socket.once('connect', () => {
        void this.call('initialize', { clientType: 'remotePad2' }, 0).then((result) => {
          clearTimeout(timer); this.clientId = result.result.clientId; resolve();
        }, (error) => { clearTimeout(timer); reject(error); });
      });
    });
    void this.initialized.catch(() => {});
  }
  private write(message: RecordValue) {
    if (this.socket.destroyed) throw new Error('Codex App disconnected');
    const body = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
    this.socket.write(Buffer.concat([header, body]));
  }
  private receive(message: RecordValue) {
    if (message.type === 'response') {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.requestId);
      if (message.resultType === 'error') pending.reject(new Error(message.error));
      else pending.resolve(message);
    } else if (message.type === 'client-discovery-request') {
      this.write({ type: 'client-discovery-response', requestId: message.requestId, response: { canHandle: false } });
    } else if (message.type === 'broadcast' && message.method === 'thread-stream-state-changed') {
      if (message.version === 13) this.onChange?.(message.params);
    }
  }
  private call(method: string, params: RecordValue, version: number, targetClientId?: string) {
    const requestId = randomUUID();
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('Codex App request timed out')); }, 10000);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.write({ type: 'request', requestId, sourceClientId: this.clientId, method, params, version, targetClientId, timeoutMs: 9000 }); }
      catch (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error); }
    });
  }
  async owner(id: string): Promise<string | null> {
    await this.initialized;
    try {
      return (await this.call('thread-owner-discovery', { hostId: 'local', conversationId: id }, 1)).handledByClientId;
    } catch (error) {
      if ((error as Error).message === 'no-client-found') return null;
      throw error;
    }
  }
  follow(id: string, owner: string, following: boolean) {
    this.write({ type: 'broadcast', sourceClientId: this.clientId, method: 'thread-stream-following-changed',
      version: 1, targetClientIds: [owner], params: { hostId: 'local', conversationId: id, following } });
  }
  async send(id: string, owner: string, text: string) {
    await this.call('thread-follower-start-turn', { conversationId: id, turnStart: {
      request: { threadId: id, input: [{ type: 'text', text, text_elements: [] }], clientUserMessageId: randomUUID() },
      context: { inheritThreadSettings: true },
    } }, 2, owner);
  }
  close() { this.socket.destroy(); }
}
export async function appOwner(id: string) {
  const app = new CodexApp();
  try { return await app.owner(id); }
  finally { app.close(); }
}

export function patchState(state: any, patches: RecordValue[]) {
  for (const patch of patches) {
    if (!Array.isArray(patch.path) || patch.path.some((key: unknown) => ['__proto__', 'constructor', 'prototype'].includes(String(key)))) throw new Error('Invalid Codex patch');
    if (!patch.path.length) { state = patch.value; continue; }
    let target = state;
    for (const key of patch.path.slice(0, -1)) target = target[key];
    const key = patch.path.at(-1);
    if (Array.isArray(target)) {
      if (patch.op === 'remove') target.splice(Number(key), 1);
      else if (patch.op === 'add') target.splice(Number(key), 0, patch.value);
      else target[Number(key)] = patch.value;
    } else if (patch.op === 'remove') delete target[key];
    else target[key] = patch.value;
  }
  return state;
}
function transcript(state: RecordValue) {
  const history = state.turnHistory?.history;
  const turns = history?.islands ? history.islands.flatMap((island: RecordValue) =>
    island.entries.map((entry: RecordValue) => history.entitiesByKey[entry.value || entry.key]).filter(Boolean)) : state.turns || [];
  const rows: { role: string; text: string }[] = [];
  for (const turn of turns) {
    const input = turn.params?.input || [];
    const user = input.filter((item: RecordValue) => item.type === 'text').map((item: RecordValue) => item.text).join('\n');
    if (user) rows.push({ role: 'You', text: user.slice(-16000) });
    for (const item of turn.items || []) {
      if (item.type === 'agentMessage') rows.push({ role: 'Codex', text: (item.text || '').slice(-16000) });
      else if (item.type === 'commandExecution') rows.push({ role: 'Command', text: (item.command || '').split('\n')[0].slice(0,400) });
    }
  }
  return { rows: rows.slice(-150), status: state.threadRuntimeStatus?.type || 'connected',
    approvals: state.requests?.length || 0 };
}
export async function registerCodexApp(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/ws/codex/:id', { websocket: true }, (socket, req) => {
    if (!req.headers.origin && !process.env.REMOTEPAD2_WORKER_SOCKET) { socket.close(1008); return; }
    const client = new CodexApp();
    let owner: string | null = null;
    let state: RecordValue | null = null;
    let revision: number | undefined;
    let disposed = false;
    let publishTimer: NodeJS.Timeout | undefined;
    const send = (value: unknown) => { if (socket.readyState === 1) socket.send(JSON.stringify(value)); };
    client.onClose = () => { if (!disposed) { send({ error: 'Codex App disconnected. Reopen this session to reconnect.' }); socket.close(); } };
    client.onChange = (params) => {
      if (params.conversationId !== req.params.id || params.hostId !== 'local') return;
      try {
        const change = params.change;
        if (change.type === 'snapshot') { state = change.conversationState; revision = change.revision; }
        else if (state && change.baseRevision === revision) { state = patchState(state, change.patches); revision = change.revision; }
        else { if (owner) { client.follow(req.params.id, owner, false); client.follow(req.params.id, owner, true); } return; }
        if (state && !publishTimer) publishTimer = setTimeout(() => {
          publishTimer = undefined;
          if (state && !disposed) send(transcript(state));
        }, 100);
      } catch { send({ error: 'Codex App protocol changed. Reopen this session.' }); }
    };
    void client.owner(req.params.id).then((found) => {
      if (disposed) return;
      owner = found;
      if (!owner) { send({ error: 'Open this conversation in Codex App to synchronize.' }); return; }
      client.follow(req.params.id, owner, true);
    }).catch((error) => send({ error: error.message }));
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(String(raw));
        if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 65536 || !owner) return;
        void client.send(req.params.id, owner, message.text).then(() => send({ sent: true })).catch((error) => send({ error: error.message }));
      } catch { send({ error: 'Invalid message' }); }
    });
    socket.on('close', () => {
      disposed = true;
      clearTimeout(publishTimer);
      if (owner) try { client.follow(req.params.id, owner, false); } catch {}
      client.close();
    });
    socket.on('error', () => socket.close());
  });
}
