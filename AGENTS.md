# RemotePad2

Terminal-first web workbench, developed in this repository on dev.

- Browser UI lives in apps/web. PTY and process ownership live in apps/server.
- Shared transport types live in packages/protocol.
- Default local ports are 6020 (built app/API) and 6021 (Vite development).
- Keep the default screen focused on the terminal. Add capabilities incrementally.
- Four component types live in apps/web/src/components: Files Index, Sessions
  Index, Editor and Terminal. The workbench in main.ts composes their instances.
- Fixed layout: Files Index on the left, Sessions Index on the right, Editor
  above Terminal in the center. Header toggles hide component areas. Editor and Terminal have their own tabs.
- Editor optionally renders Markdown/HTML in a sandboxed iframe.
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
- Right header opens the Computers menu: local host, connected targets,
  ~/.ssh/config aliases (including Includes), and an SSH command field.
- SSH parsing accepts a config alias, user@host, or ssh with -p/-i/-J.
  Arguments go directly to OpenSSH; arbitrary remote commands are rejected.
- ssh.ts installs a versioned API backend under ~/.remotepad2/backend on the
  target. Target prerequisites are POSIX/OpenSSH, Node.js 22+ and pnpm in PATH.
  A persistent private Unix-socket backend owns remote PTYs; SSH is transport.
- The worker exposes files/navigation/sessions/Codex on the target. Browser
  URLs and localStorage are machine-scoped. Local SSH settings stay local.
- pnpm test checks IPC ownership/input routing/patching and SSH argument parsing.
