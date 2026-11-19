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
  Markdown/HTML, images, JSON/JSONL, CSV/TSV and log rendering. Debug capability will be added later.
- **Terminal** attaches to a backend-owned PTY. Agent CLIs can run here.

The right-header **Layout** icon opens a popover that mirrors the screen: Files left, Sessions
right, Editor above Terminal in the middle. Its four tiles hide/show each area;
grey bottom tiles are inactive. Drag the panel borders to
resize; hidden panels keep their last dimensions. Files and sessions open in their own
Editor and Terminal tabs. The fixed layout has Files Index on the left, Sessions Index on the right,
and Editor above Terminal in the center. All four areas are initially visible.

Files Index offers an expandable tree, Favorites and Repos. Existing RemotePad
pins are copied once into ~/.remotepad2/navigation.json and managed separately.
Each tree directory has ◆ Repo and ★ Favorite toggles, independent of expansion.

Click **RemotePad2** at the top left for installed version/branch/commit,
local branch versions and **Windows**. **+ New** and window rows open another
browser window; right-click offers rename or open in this window. × forgets
its saved layout, including the default window.
Window profiles persist in ~/.remotepad2/windows.json on the local backend,
with browser storage as a live cache. Each machine and window remembers panel
sizes, visibility, directory, Editor/Explorer tabs, split state, hidden-file
filter and the selected shell. Switching leaves shells running.
The version view is read-only; it never changes Git branches or restarts a server.

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

The top-right label shows the current SSH target when remote (hover for its
actual hostname) and the local hostname otherwise. Click it for its details and connected
remote machines. Expand **Add SSH connection** to choose an alias from
~/.ssh/config (including Include files), or enter a host or SSH command:

```sh
ssh -p 22 -i "/path/to/key" -J jump-host user@machine
```

Connection progress shows the current phase and elapsed seconds: SSH login,
checking/installing the backend, opening the tunnel and health validation.
A matching backend is reused; new backend revisions install once. Jump-host
handshakes can account for most connection time.

The connection uses your existing OpenSSH keys and known hosts. Authenticate
and verify a new host in Terminal first if needed. The first connection
uploads the API source and installs locked dependencies under
~/.remotepad2/backend on the remote machine. That machine needs OpenSSH Unix
socket forwarding, a POSIX shell and Node.js 22+ with npm in its non-interactive PATH.
RemotePad2 reuses a matching pnpm or prepares its pinned version under
~/.remotepad2/tools automatically. Global packages and shell startup files
are not modified.

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
revision to catch external edits. Code uses a compact 12px font. Source / Render
uses the bottom-left **</>** status button (Ctrl/⌘+L) to switch editable text
and its viewer. Save is in the right-click menu / Ctrl/⌘+S, without a toolbar
button. **◫** in the tab strip opens a draggable second editor pane; buffers
and save state stay synchronized between both panes. Rendered Markdown and HTML run
in sandboxed iframes with relative images, scripts and styles resolved through
the selected machine. Binary previews allow up to 32 MB.

The tree address input is a popup opened with **Go to path**, beside Refresh.
The **.*** button shows/hides dotfiles in tree and Explorer. The root and
selected ancestor directories stay frozen at the top of the tree while scrolling.

Use directory-popup Enter or a folder’s **Open in Explorer** context
menu to open a folder tab. The tree expands on a single click; double-click
opens Explorer and leaves the folder expanded, without a click-delay timer.
Explorer items select on click (Ctrl/Cmd multi-select, Shift range) and open through double-click
or the **Open** context menu. Its toolbar offers Icons, Details, parent and
refresh controls. Details shows file size and modification time; folder tab
context menus also offer Refresh. Files Index lists regular files and directories.

Files, sessions, editor and terminal views are separate modules. Future
layout presets can compose these same components as an IDE or Agent Manager.
Debugging and Agent-specific hooks will share explicit execution identities.

Run `pnpm test` for the integration protocol checks.

UI regression checks: `pnpm build && pnpm test:e2e`. Run
`pnpm exec playwright install chromium` first, or use
`E2E_CHANNEL=chrome pnpm test:e2e` with installed Chrome. Tests start an
isolated backend on 6220 with HOME/fixtures under ~/work/tmp/remotepad2-e2e.
Override E2E_PORT/E2E_WORK_ROOT to select another isolated location.
