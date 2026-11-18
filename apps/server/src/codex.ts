import os from 'node:os';
import path from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { CodexSession } from '@remotepad2/protocol';

export function codexSessions(): CodexSession[] {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  if (!existsSync(home)) return [];
  const names = readdirSync(home).filter((name) => /^state_\d+\.sqlite$/.test(name))
    .sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]));
  for (const name of names) {
    const db = new DatabaseSync(path.join(home, name), { readOnly: true });
    try {
      const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map((row) => row.name));
      const projectTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('projects','project_roots')").all();
      const withProjects = projectTables.length === 2 && columns.has('project_id');
      const title = columns.has('name') ? "COALESCE(NULLIF(t.name,''), t.title)" : 't.title';
      const project = withProjects ? `COALESCE(p.name, (SELECT p2.name FROM projects p2 JOIN project_roots r ON r.project_id=p2.id
        WHERE r.path=t.cwd ORDER BY r.position LIMIT 1))` : 'NULL';
      return db.prepare(`SELECT t.id, ${title} AS title, t.cwd, t.updated_at, ${project} AS project
        FROM threads t ${withProjects ? 'LEFT JOIN projects p ON p.id=t.project_id' : ''}
        WHERE t.archived=0 ORDER BY t.updated_at DESC LIMIT 200`)
        .all().map((row) => ({
          project: row.project ? String(row.project) : path.basename(String(row.cwd || '')),
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
