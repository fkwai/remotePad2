# RemotePad2

Terminal-first web workbench, developed in this repository on dev.

- Browser UI lives in apps/web. PTY and process ownership live in apps/server.
- Shared transport types live in packages/protocol.
- Default local ports are 6020 (built app/API) and 6021 (Vite development).
- Keep the default screen focused on the terminal. Add capabilities incrementally.
- Four component types live in apps/web/src/components: Files Index, Sessions
  Index, Editor and Terminal. The workbench in main.ts composes their instances.
- Fixed layout: Files Index on the left, Sessions Index on the right, Editor
  above Terminal in the center. Layout popover controls panel visibility. Editor
  and Terminal have their own tabs. Drag the three separators to resize; hiding
  a panel preserves its geometry, including across reloads.
- Editor defaults to rendered Markdown/HTML, images, JSON/JSONL, CSV/TSV and logs.
  Source / Render switches editable text; code uses a 12px font. Markdown/HTML
  use opaque sandbox frames. Preview capability paths preserve relative assets
  locally and through SSH without allowing sandbox access to normal APIs.
- Folder Explorer opens from directory Enter or tree right-click Open in
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
- Left RemotePad2 popover shows read-only installed version/branch/commit
  from local /api/version and manages named workspace sessions (?w=). Each
  machine + session keeps panel sizes/visibility, directory, editor tabs and
  shell selection in localStorage. Switching/forgetting does not stop shells;
  unsaved buffers remain memory-only. Default session keeps legacy storage keys.
- Right header always names the local machine. Its Computers menu starts with
  user/platform/home and connected remotes; Add SSH connection is collapsed
  until clicked, then reveals config aliases (including Includes) and command input.
- SSH parsing accepts a config alias, user@host, or ssh with -p/-i/-J.
  Arguments go directly to OpenSSH; arbitrary remote commands are rejected.
- ssh.ts installs a versioned API backend under ~/.remotepad2/backend on the
  target. Target prerequisites are POSIX/OpenSSH and Node.js 22+ with npm. Missing or
  mismatched pnpm is bootstrapped at the version in package.json into
  ~/.remotepad2/tools, without changing global tools or shell configuration.
  A persistent private Unix-socket backend owns remote PTYs; SSH is transport.
- The worker exposes files/navigation/sessions/Codex on the target. Browser
  URLs and localStorage are machine-scoped. Local SSH settings stay local.
- pnpm test checks IPC ownership/input routing/patching and SSH argument parsing.

- UI regressions: pnpm build && pnpm test:e2e (install Chromium with pnpm exec
  playwright install chromium, or E2E_CHANNEL=chrome for installed Chrome).
  Harness uses an isolated HOME, port 6220 (E2E_PORT overrides), and fixtures
  under ~/work/tmp/remotepad2-e2e (E2E_WORK_ROOT overrides). Never restart the
  existing instance to test UI changes.
