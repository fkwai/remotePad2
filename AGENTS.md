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
- Sessions Index reads local Codex metadata using read-only SQLite, with the
  JSONL session index as fallback. Clicking resumes via the installed Codex CLI
  in a backend PTY. Repeated clicks reuse a running RemotePad2 Codex session.
- Codex state and credentials remain owned by Codex; RemotePad2 does not alter
  its database. The CLI itself manages resumed session history.
