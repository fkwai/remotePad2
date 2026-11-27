export type AgentKind = 'shell' | 'codex' | 'claude' | 'custom';
export const agentKinds: {id:AgentKind;label:string}[] = [{id:'shell',label:'Shell'},{id:'codex',label:'Codex'},{id:'claude',label:'Claude Code'},{id:'custom',label:'Custom CLI'}];
export interface SessionCreate {agent?:AgentKind; name?:string; cwd?:string; project?:string; command?:string; codexId?:string}
export interface SessionInfo { id: string; name: string; cwd: string; agent?:AgentKind; project?:string; machine?:string; createdAt?:number; renamed?:boolean; codexId?: string; kind?: 'shell' | 'codex-app' | 'ssh-connect'; sshTarget?: string; alive: boolean; exitCode?: number }
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

export interface SshProgress { connected?: boolean; phase?: string; startedAt?: number; error?: string; terminal?: SessionInfo }
