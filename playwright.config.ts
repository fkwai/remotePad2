import { defineConfig } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync } from 'node:fs';
const root = process.env.E2E_WORK_ROOT || path.join(os.homedir(), 'work/tmp/remotepad2-e2e');
mkdirSync(path.join(root, 'home'), { recursive: true });
const port = process.env.E2E_PORT || '6220';
export default defineConfig({
  testDir: './tests/e2e', workers: 1, timeout: 30000,
  outputDir: path.join(root, 'results'),
  use: { channel: process.env.E2E_CHANNEL, baseURL: 'http://127.0.0.1:' + port, viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'apps/server/node_modules/.bin/tsx apps/server/src/index.ts',
    env: { HOME: path.join(root, 'home'), REMOTEPAD2_PORT: port },
    url: 'http://127.0.0.1:' + port + '/api/health', reuseExistingServer: false,
  },
});
