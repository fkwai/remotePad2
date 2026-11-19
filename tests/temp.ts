import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
export const tempRoot = process.env.REMOTEPAD2_TEST_TMP || path.join(os.homedir(), 'work/tmp');
mkdirSync(tempRoot, { recursive: true });
