# RemotePad2

Terminal-first web workbench, developed in this repository on dev.

- Browser UI lives in apps/web. PTY and process ownership live in apps/server.
- Shared transport types live in packages/protocol.
- Default local ports are 6020 (built app/API) and 6021 (Vite development).
- Keep the default screen focused on the terminal. Add capabilities incrementally.
- Future plugins open panels within the workbench and share explicit machine,
  directory and execution-session identity. Agent runtime remains external.
- Preserve working terminal input, sizing, shutdown and connection feedback.
- Update this map after UI or interaction changes.
- Verify with pnpm build and an actual shell input/output check.
