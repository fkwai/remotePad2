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

## Four components

- **Files Index** browses local directories and opens files in Editor.
- **Sessions Index** selects existing shells or creates another.
- **Editor** edits UTF-8 files with save/conflict detection and optional
  Markdown or HTML rendering. Debug capability will be added later.
- **Terminal** attaches to a backend-owned PTY. Agent CLIs can run here.

Header toggles hide or show each area. Files and sessions open in their own
Editor and Terminal tabs. The fixed layout has Files Index on the left, Sessions Index on the right,
and Editor above Terminal in the center. All four areas are initially visible.

Files Index offers an expandable tree, Favorites and Repos. Existing RemotePad
pins are copied once into ~/.remotepad2/navigation.json and managed separately.

Sessions Index lists up to 200 unarchived Codex sessions using your custom
title and project label. For a conversation owned by the running local Codex
App, RemotePad2 subscribes to that same conversation and routes typed messages
back to its owner. The synchronized view lives inside the Terminal area.
Approvals and interactive tool questions are handled in the Codex App.

This integration uses the installed desktop App's IPC follower protocol and is
version-dependent. A protocol mismatch or disconnected App is shown as an error.
When no App owns the conversation, RemotePad2 uses the installed CLI to resume
it. Closing an App-linked view detaches that view and leaves the App running.

## SSH

Click the computer name at the top right. Choose an alias from ~/.ssh/config
(including Include files), or enter a host or SSH command:

```sh
ssh -p 22 -i "/path/to/key" -J jump-host user@machine
```

The connection uses your existing OpenSSH keys and known hosts. Authenticate
and verify a new host in Terminal first if needed. The first connection
uploads the API source and installs locked dependencies under
~/.remotepad2/backend on the remote machine. That machine needs OpenSSH Unix
socket forwarding, a POSIX shell, Node.js 22+ and pnpm in its non-interactive PATH.

The backend runs as your SSH user on a private Unix socket and survives a
transport disconnect. Files, terminals and Codex metadata belong to the selected
machine. Local SSH config stays on the local machine. Directory and session
restore keys are scoped by SSH target. Reconnect from the menu after restarting
the local server. Each backend revision has its own running sessions.

Shells survive refresh, browser closure and network loss while the backend
remains running. Sessions Index can reopen them with bounded output replay.
Closing a Terminal tab ends the process. Hiding an area keeps its tabs and
processes. Exited sessions retain their output until the tab is closed.
Backend restarts end sessions. Unsaved editor buffers are kept in browser
memory, with a browser warning before leaving.

The current Editor supports UTF-8 text up to 2 MB. Save checks the file's
revision to catch external edits. Rendered Markdown and HTML run in a
sandboxed iframe. Files Index currently lists regular files and directories.

Files, sessions, editor and terminal views are separate modules. Future
layout presets can compose these same components as an IDE or Agent Manager.
Debugging and Agent-specific hooks will share explicit execution identities.

Run `pnpm test` for the integration protocol checks.
