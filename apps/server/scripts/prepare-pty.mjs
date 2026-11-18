import { randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

if (process.platform === 'darwin') {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve('node-pty/package.json'));
  const helper = path.join(root, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper');

  // Some node-pty packages ship the prebuilt helper without its execute bit.
  // Replace our own copy so a pnpm hard link cannot change another install.
  if (existsSync(helper) && (statSync(helper).mode & 0o100) === 0) {
    const staged = `${helper}.${randomUUID()}`;
    try {
      copyFileSync(helper, staged);
      chmodSync(staged, 0o755);
      renameSync(staged, helper);
    } finally {
      rmSync(staged, { force: true });
    }
  }
}
