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

Sessions Index also lists the latest 200 unarchived local Codex sessions. Click
one to run `codex resume <id> --no-alt-screen` in its original directory using
the installed CLI and its existing configuration. A running RemotePad2 session
is reused on subsequent clicks. The index refresh button reloads Codex metadata.
This opens a CLI session; it does not attach to an existing desktop app process.

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
