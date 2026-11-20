# RemotePad2

Terminal-first web workbench, developed in this repository on dev.

- Browser UI lives in apps/web. PTY and process ownership live in apps/server.
- Shared transport types live in packages/protocol.
- Default local ports are 6020 (built app/API) and 6021 (Vite development).
- Keep the default screen focused on the terminal. Add capabilities incrementally.
- Four component types live in apps/web/src/components: Files Index, Sessions
  Index, Editor and Terminal. The workbench in main.ts composes their instances.
- Fixed layout: Files Index on the left, Sessions Index on the right, Editor
  above Terminal in the center. Right-header Layout popover uses a spatial grid: left Files, right Sessions,
  center-top Editor, center-bottom Terminal; grey bottom cells are inactive.
  Its four buttons toggle panel visibility. Layout and reset use compact icon
  buttons with accessible labels/tooltips; tree and Explorer refresh do too. Editor
  and Terminal have their own tabs. Drag the three separators to resize; hiding
  a panel preserves its geometry, including across reloads.
- Editor defaults to rendered Markdown/HTML, images, JSON/JSONL, CSV/TSV and logs.
  The bottom-left </> status button switches source/rendered (Ctrl/⌘+L);
  Save exists only in context menus / Ctrl/⌘+S, with no editor top toolbar.
  Code uses a 12px font. The tab-strip ◫ opens a draggable second editor, with
  shared dirty buffers and saves across panes; split state/ratio are restored. Markdown/HTML
  use opaque sandbox frames. Preview capability paths preserve relative assets
  locally and through SSH without allowing sandbox access to normal APIs.
- File tree address input lives in the Go to path popover beside Refresh;
  .* toggles dotfiles in both tree and Explorer and persists per window.
  File tree is its own scroll container. Parent row plus every expanded folder
  in the scrolled subtree stick consecutively at 28px intervals, independent of
  selection. Nested .tree-branch containers bound stickiness to each subtree;
  there is no top padding/margin gap or sticky bleed into sibling branches.
- File tools are icon-only Search / Favorites / Repos, followed by Refresh,
  Go to path and hidden-files. The first three toggle independent docked
  sections (all enabled initially), persisted per window as sidebar-panels.
  Favorites/Repos are no longer mutually exclusive tabs. SVG icons share one
  stroke style; directory pin toggles remain independent.
- Filename search: /api/search (local or SSH) returns bounded nested file/dir
  matches, respecting hidden files and skipping dependency/cache directories.
  Search input debounces requests and cancels stale responses; it never delays
  folder clicks. Pending listings for the same directory share one request,
  so double-click does not send duplicate tree loads. Sidebar panel visibility is in the server window snapshot.
- Folder Explorer opens from directory-popup Enter or tree right-click Open in
  Explorer (double-click / Enter shortcuts). No Open folder toolbar button.
  Tree rows keep their DOM identity: click toggles immediately; the second
  click ensures expansion and opens Explorer without any click-delay timer.
  Each directory, including the root, has independent ◆ Repo / ★ Favorite toggles.
- Explorer items select on click (Ctrl/Cmd toggles, Shift selects a range),
  open on double-click / right-click Open / Enter; Icons/Details toggle the
  listing with file size and modification time. Folder tabs have a Refresh menu.
- Terminal readiness/reconnection never steals focus from file/editor inputs.
- Binary previews allow 32 MB; the editable UTF-8 limit remains 2 MB.
- Backend PTYs survive browser closure and reconnect via stable session IDs.
  Closing a Terminal tab explicitly deletes that session and ends its process.
  Backend shutdown ends all sessions; server-restart persistence is not provided.
- Files are local UTF-8 text up to 2 MB. Saves check a content revision, then
  replace the file atomically. Unsaved buffers remain in browser memory.
- Agent CLIs run in terminal sessions. Agent runtime remains external.
- Preserve working terminal input, sizing, shutdown and connection feedback.
- Update this map after UI or interaction changes.
- Verify with pnpm build and an actual shell input/output check.

- Files Index uses expandable folders, Favorites and Repos. Initial pins are
  imported from ~/.remotepad; subsequent edits live in ~/.remotepad2/navigation.json.
- Sessions Index reads Codex metadata using read-only SQLite with the JSONL
  index as fallback. Prefer the custom name and show its project name (cwd
  folder as fallback).
- For an App-owned local conversation, Terminal uses the Codex App follower
  adapter in codex-app.ts. It subscribes to the same thread and routes input to
  its owner without another resume process. Closing its view detaches; it never
  terminates the App's conversation. Approval prompts remain in Codex App.
- The App follower uses the installed desktop IPC protocol (state stream v13,
  start-turn v2). It is version-dependent and must fail visibly on incompatibility.
- Unowned Codex histories use the installed CLI via codex resume. RemotePad2
  does not edit the Codex database. The owning App or CLI writes its history.
- Left RemotePad2 wordmark opens only the workbench Sessions list: count,
  names and machine hostname/SSH destination. The adjacent, separately clickable
  main/dev/nightly badge opens Versions with installed version and lane switching.
  Version information never belongs in the wordmark Sessions menu.
  + New and window rows open another browser window; right-click offers same-
  window open and rename. × forgets the saved layout (including default).
- Local /api/windows stores window snapshots in ~/.remotepad2/windows.json,
  keyed by machine + window id (?w=). Browser storage is the live cache; boot
  restores server state before constructing layout. Snapshots include geometry,
  visibility, directory, editor tabs/split, hidden-file filter and shell selection.
  Switching/forgetting does not end shells. Unsaved buffers stay memory-only.
  ?reset=1 skips restoration; forgetting current window cancels its save timer.
- Right header names the active SSH target while remote, the local hostname
  while local. Async local-host discovery must never overwrite the SSH label.
  Machine controls mount before workspace health checks so reconnect stays
  available if a remote backend is unavailable. Tooltip includes remote hostname.
  Its Computers menu is the SSH manager: local user/platform/home, saved machines
  with Connected / Not connected / Connecting state and Open / Connect actions.
  Refresh and a 3-second poll update states while open. Add SSH connection is
  collapsed until clicked and reveals config aliases (including Includes),
  command and optional name. Save machine adds without connecting; star pins a
  config alias or existing connection. Trash removes only the saved entry, never
  edits SSH config or disconnects a live transport. Destinations persist locally
  in ~/.remotepad2/ssh-machines.json, shared across lanes. GET /api/ssh/hosts
  includes saved rows; POST /api/ssh/machines and DELETE /api/ssh/machines/:id
  are local-only, validated with the same argument parser as Connect.
- Connect creates an ordinary local PTY session (kind ssh-connect), opens it
  in Terminal and runs /bin/bash -x <private-script> for packaging and setup. Both local SSH
  invocations and remote bootstrap commands are traced where they execute;
  raw stdout/stderr and interactive /dev/tty authentication use that same PTY.
  POST /api/ssh/connect returns its terminal immediately; status polls only
  readiness/phase, never a transcript. SSH terminals always use local WS/API
  even when launched from a remote workbench. Shell returns after setup and
  remains usable; browser closure never ends it. Closing the tab ends the shell
  and cancels an unfinished command. A successful -fN ControlMaster transport
  is owned separately by SSH management, so closing its setup shell leaves
  remote workspaces/PTYs connected. Local backend shutdown explicitly stops
  masters via their private control sockets; remote workers remain alive.
  Success opens a new browser tab retaining lane, ?w= and setting ?ssh=; the
  original workspace stays open. Local windows restore the selected SSH setup
  terminal like any shell; remote windows keep their remote-shell selection. A ↗ link on the setup terminal tab supports
  popup-blocked browsers. No read-only connection-log component exists.
- Escape closes an open popover in capture phase and consumes the key before
  the underlying terminal receives it (avoids entering shell vi command mode).
- SSH parsing accepts a config alias, user@host, or ssh with -p/-i/-J.
  Arguments go directly to OpenSSH; arbitrary remote commands are rejected.
- ssh.ts installs a versioned API backend under ~/.remotepad2/backend/<channel>/<revision> on the
  target. Target prerequisites are POSIX/OpenSSH and Node.js 22+ with npm. Missing or
  mismatched pnpm is bootstrapped at the version in package.json into
  ~/.remotepad2/tools, without changing global tools or shell configuration.
  A persistent private Unix-socket backend owns remote PTYs; SSH is transport.
  Local health probes allow 5 seconds per request (jump RTT can exceed 500ms),
  with a 30-second total tunnel deadline. Connection progress/errors appear
  above the alias list and in the main status bar, even while the list is open.
  /api/ssh/:host/status reports terminal, phase and start time; the UI polls phases with elapsed
  seconds during connect. Bootstrap reports UID on its existing connection,
  avoiding another SSH handshake just to run id -u. New host confirmations and
  passphrase/password prompts appear in the real setup terminal.
- The worker exposes files/navigation/sessions/Codex on the target. Browser
  URLs and localStorage are machine-scoped. Local SSH settings stay local.
- pnpm test checks IPC ownership/input routing/patching and SSH argument parsing.

- UI regressions: pnpm build && pnpm test:e2e (install Chromium with pnpm exec
  playwright install chromium, or E2E_CHANNEL=chrome for installed Chrome).
  Harness uses an isolated HOME, port 6220 (E2E_PORT overrides), and fixtures
  under ~/work/tmp/remotepad2-e2e (E2E_WORK_ROOT overrides). Never restart the
  existing instance to test UI changes.

## Release channels / gateway

- The standing branches are main (stable/default), dev (normal development),
  nightly (Actions publishes validated dev snapshots). Initial main creation
  was explicitly requested by the user. Future development stays on dev; main
  promotion needs a release request. Never force-push.
- .github/workflows/ci.yml gates main/dev pushes and PRs. nightly.yml runs daily
  00:00 UTC / 08:00 Asia/Shanghai and on manual dispatch. It stamps package.json,
  verifies build + unit + browser + gateway tests, then commit-tree publishes the
  validated dev tree with previous nightly as a parent (ordinary FF push). It
  leaves main and local runtimes unchanged. scripts/nightly-version.mjs owns stamps.
- One gateway entry defaults to 6020: /main/, /dev/, /nightly/. No more one-off
  public preview ports in the product flow. A port conflict refuses startup;
  never stop the occupied instance just to make the gateway bind.
- apps/server/src/gateway.ts proxies HTTP + WebSocket over private Unix sockets.
  lanes.ts / lane-cli.ts manage starts/status/explicit stops. pnpm gateway and
  pnpm lanes start|stop main|dev|nightly; status lists all. Only an explicit stop
  ends shells. Starting an already running lane never rebuilds/restarts it.
- Full local socket backends use REMOTEPAD2_LOCAL_SOCKET and keep SSH/version/
  windows/static routes. REMOTEPAD2_WORKER_SOCKET remains API-only remote mode;
  do not conflate them. REMOTEPAD2_GATEWAY_PORT is the public origin check.
- Runtime sockets/logs/metadata: ~/.remotepad2/run. Main/nightly use managed,
  detached worktrees in ~/work/remotepad2-lanes; dev uses this dev checkout.
  Starting a stopped managed lane fetches its published SHA and refuses dirty
  worktrees. No Git branch changes are made in the user's checkout.
- apps/web/src/base.ts preserves the lane path for local APIs/assets/windows;
  connection.ts preserves it for remote proxy calls and WebSockets. Raw fetch is
  only for gateway-global /_gateway management APIs or already-prefixed URLs.
- Version menu shows Start/Switch when opened through the gateway, preserving
  ?w= and SSH target. Window layout is shared, while selected shell keys are
  session.main/session.dev/session.nightly (legacy direct mode keeps session).
- Gateway tests: pnpm test:gateway. They start 3 throwaway full backends over
  Unix sockets behind one throwaway gateway on E2E_PORT; no live lane is touched.
  Tests use portable ~/work/tmp paths (REMOTEPAD2_TEST_TMP overrides unit temp root).

- A selected lane owns UI + local API + SSH worker. Remote installs and sockets
  include main/dev/nightly plus revision, preventing identical-code lanes from
  sharing PTYs. Worker health reports its channel. Changing a lane never kills
  another worker. Target project files remain shared, not sandboxed per lane.
