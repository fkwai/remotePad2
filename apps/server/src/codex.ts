import os from 'node:os';
import path from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { CodexSession } from '@remotepad2/protocol';

export function codexSessions(): CodexSession[] {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const names = readdirSync(home).filter((name) => /^state_\d+\.sqlite$/.test(name))
    .sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]));
  for (const name of names) {
    const db = new DatabaseSync(path.join(home, name), { readOnly: true });
    try {
      return db.prepare('SELECT id, title, cwd, updated_at FROM threads WHERE archived = 0 ORDER BY updated_at DESC LIMIT 200')
        .all().map((row) => ({
          id: String(row.id), title: String(row.title || row.id),
          cwd: String(row.cwd || os.homedir()), updatedAt: Number(row.updated_at) * 1000,
        }));
    } catch { /* Older schema: try another index. */ }
    finally { db.close(); }
  }
  const index = path.join(home, 'session_index.jsonl');
  if (!existsSync(index)) return [];
  const sessions = new Map<string, CodexSession>();
  for (const line of readFileSync(index, 'utf8').split('\n')) {
    try {
      const row = JSON.parse(line);
      if (typeof row.id === 'string') sessions.set(row.id, {
        id: row.id, title: row.thread_name || row.id,
        cwd: os.homedir(), updatedAt: Date.parse(row.updated_at) || 0,
      });
    } catch { /* A partially written last line is retried on refresh. */ }
  }
  return [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200);
}
