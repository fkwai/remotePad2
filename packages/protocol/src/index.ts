/** Browser actions and backend events for one terminal per WebSocket. */
export type TerminalInput =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number };

export type TerminalEvent =
  | { type: 'ready'; hostname: string; cwd: string }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string };
