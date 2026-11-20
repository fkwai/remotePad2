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

Files Index has an icon toolbar for Search, Favorites and Repos. These toggle
independent docked sections, so all three can stay open together; visibility is
saved with the window. Filename search includes nested folders, respects the
hidden-file filter and skips dependency/cache directories. Existing RemotePad
pins are copied once into ~/.remotepad2/navigation.json and managed separately.
Each tree directory has ◆ Repo and ★ Favorite toggles, independent of expansion.

Click **RemotePad2** at the top left for **Sessions**, their count and the
machine each belongs to. The adjacent **main/dev/nightly** badge opens version
information and channel switching. **+ New** and window rows open another
browser window; right-click offers rename or open in this window. × forgets
its saved layout, including the default window.
Window profiles persist in ~/.remotepad2/windows.json on the local backend,
with browser storage as a live cache. Each machine and window remembers panel
sizes, visibility, directory, Editor/Explorer tabs, split state, hidden-file
filter and the selected shell. Switching leaves shells running.
Switching versions navigates to a separate lane; it never switches the checkout
or restarts a running server. **Start** can launch a stopped lane.

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
remote machines. Saved machines show their connection state with **Connect**
or **Open**; the list refreshes while the menu is open. **Save machine** stores
a destination and optional display name without connecting. Star an SSH config
alias or an existing connection to save it. The trash button removes that saved
entry without disconnecting or editing SSH config. This list is stored locally
in `~/.remotepad2/ssh-machines.json` and shared across channels.
Expand **Add SSH connection** to choose an alias from
~/.ssh/config (including Include files), or enter a host or SSH command:

```sh
ssh -p 22 -i "/path/to/key" -J jump-host user@machine
```

Connection progress shows the current phase and elapsed seconds: SSH login,
checking/installing the backend, opening the tunnel and health validation.
Connect opens an ordinary **interactive Terminal** and executes the setup
script there. Shell tracing shows each SSH/bootstrap command as it runs with
its original stdout/stderr; password/passphrase/host confirmation prompts can
be answered in that terminal. Ctrl+C cancels the running setup. The shell stays
open and usable after success or failure. Closing its tab ends that shell;
closing the browser only detaches. A successful SSH tunnel is an independent
ControlMaster, so closing the setup terminal does not disconnect the workspace.
Once connected, a new browser tab opens the remote workspace in the same
channel and window profile; the original workspace stays open. If the browser
blocks it, use the ↗ **Open remote workspace** link on the setup terminal tab.
A matching backend is reused; new backend revisions install once. Jump-host
handshakes can account for most connection time.

The connection uses your existing OpenSSH keys and known hosts. New-host
confirmation and authentication are handled by OpenSSH in the setup terminal. The first connection
uploads the API source and installs locked dependencies under
~/.remotepad2/backend/<channel>/<revision> on the remote machine. That machine needs OpenSSH Unix
socket forwarding, a POSIX shell and Node.js 22+ with npm in its non-interactive PATH.
RemotePad2 reuses a matching pnpm or prepares its pinned version under
~/.remotepad2/tools automatically. Global packages and shell startup files
are not modified.

The backend runs as your SSH user on a private Unix socket and survives a
transport disconnect. Files, terminals and Codex metadata belong to the selected
machine. Local SSH config stays on the local machine. Directory and session
restore keys are scoped by SSH target. Reconnect from the menu after restarting
the local server. Each channel and backend revision has its own worker and running sessions.
Switching channels never terminates another channel’s shells. Project files
on the same target are shared; channels are not filesystem sandboxes.

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
The **.*** button shows/hides dotfiles in tree and Explorer. Expanded ancestor directories stay frozen in a continuous stack while scrolling,
without selecting a leaf. Each stack stops at its subtree boundary; siblings
never inherit old frozen rows.

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

## Channels and one local entry

- `main` is the stable release and default GitHub branch. Development commits go to `dev`.
- GitHub Actions validates `main`/`dev` pushes and PRs. Daily at **08:00 Asia/Shanghai**,
  Nightly checks out `dev`, stamps `X.Y.Z-nightly.YYYYMMDD`, builds and runs unit,
  UI and gateway tests, then publishes the validated snapshot to `nightly`.
  A failed run keeps the previous nightly. Publication uses a normal fast-forward
  push with the previous nightly as a parent; it never force-pushes.
- Stable promotion is explicit: review the chosen snapshot, merge/release it to
  `main` with a normal release version. Nightly never updates main automatically.

The gateway replaces per-preview port links. The public default is **6020**:

| URL | Instance |
| --- | --- |
| `http://127.0.0.1:6020/` | redirects to `/main/` |
| `/main/` | stable |
| `/dev/` | current development checkout |
| `/nightly/` | latest validated daily snapshot |

Each instance listens on a private Unix socket under `~/.remotepad2/run`;
there are no internal HTTP ports to allocate. The gateway proxies HTML, APIs,
file/HTML preview assets and terminal/Codex WebSockets. Windows and local SSH
settings stay local. Click the separate **main/dev/nightly badge** beside the
RemotePad2 wordmark for Versions. The wordmark itself lists only workbench
sessions and their machines. Versions → **Start/Switch** opens a lane in the current
window, preserving `?w=` and the SSH selection; Ctrl/Cmd-click opens a new tab.
Layout/window profiles are shared across channels; selected PTYs are tracked
per channel because their processes belong to separate backends. A channel
selects its UI, local server and matching SSH worker together. Remote workers
are namespaced by channel even when code revisions are identical.

```sh
pnpm gateway              # one public listener; leave running
pnpm lanes start main     # or click Start on the stopped lane's page
pnpm lanes start dev
pnpm lanes start nightly
pnpm lanes status
pnpm lanes stop nightly   # explicit stop ends that lane's shells
```

`dev` runs this checkout without switching its branch. Stable/nightly get
managed detached worktrees under `~/work/remotepad2-lanes`. A stopped lane
fetches its published branch when started. Starting a running lane leaves it
untouched; publishing Git commits does not restart a running backend. Dirty
managed worktrees are refused rather than overwritten. Build/start logs are
under `~/.remotepad2/run/<channel>.log`.

If the old standalone app already occupies 6020, the gateway refuses to bind
and leaves it running. Moving that entry to the gateway requires an explicit
stop of that old instance; it is never taken over automatically. The old direct
`pnpm start` and optional Vite development entry remain supported for diagnostics.

Overrides: `REMOTEPAD2_GATEWAY_PORT` changes the one public port;
`REMOTEPAD2_RUN_DIR` changes the socket/log directory, and
`REMOTEPAD2_LANES_DIR` changes the managed worktree root. Use the same gateway
port for all lane commands. Gateway checks: `pnpm test:gateway` (or
`E2E_CHANNEL=chrome pnpm test:gateway`).
