# RemotePad2

A terminal-first web workbench. Open a browser and work in a real shell.
Future plugins can open panels for files, agents and live debugging.

## Run

Requires Node.js 22+ and pnpm 10.

```sh
pnpm install
pnpm dev
```

Open http://127.0.0.1:6021 during development. For the built app:

```sh
pnpm build
pnpm start
```

Open http://127.0.0.1:6020. The backend binds to loopback and runs shells
as the current OS user. It provides local access without an account system.

## Structure

- `apps/web` owns the browser terminal and layout.
- `apps/server` owns PTY processes and the HTTP/WebSocket transport.
- `packages/protocol` defines messages shared by both sides.

Each browser tab gets its own login shell in the user's home directory.
Closing the tab or losing its connection ends that shell. “New terminal”
starts a fresh shell after an exit or disconnect. Output is streamed with
backpressure and retained in the browser's bounded scrollback.

The initial skeleton contains terminal capability. File panels, SSH,
Agent sessions and debugging will be added incrementally. Plugins should
use backend capabilities and a shared execution-session identity so an
editor, debugger, console and Agent can operate on the same live context.
RemotePad2 provides the workbench and integrates existing Agent runtimes.
