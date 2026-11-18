export interface SessionInfo { id: string; name: string; cwd: string; alive: boolean; exitCode?: number }
export type TerminalInput =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number };
export type TerminalEvent =
  | { type: 'ready'; session: SessionInfo; replay: string }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string };
export interface FileEntry { name: string; path: string; directory: boolean }
export interface FileContent { path: string; content: string; revision: string }
