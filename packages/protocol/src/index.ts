export interface SessionInfo { id: string; name: string; cwd: string; codexId?: string; kind?: 'shell' | 'codex-app' | 'ssh-connect'; sshTarget?: string; alive: boolean; exitCode?: number }
export type TerminalInput =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number };
export type TerminalEvent =
  | { type: 'ready'; session: SessionInfo; replay: string }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string };
export interface FileEntry { name: string; path: string; directory: boolean; size?: number; modifiedAt?: number }
export interface FileContent { path: string; content: string; revision: string }
export interface CodexSession { id: string; title: string; cwd: string; updatedAt: number; project?: string }
export interface PinnedFolder { path: string; name: string; branch?: string }
export interface Navigation { favorites: PinnedFolder[]; repos: PinnedFolder[] }

export interface SshProgress { connected?: boolean; phase?: string; startedAt?: number; error?: string; runId?: string; logs?: {seq:number;text:string}[]; nextSeq?: number }
