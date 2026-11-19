import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const file = new URL('../package.json', import.meta.url);
const data = JSON.parse(readFileSync(file, 'utf8'));
const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
data.version = data.version.split('-')[0] + '-nightly.' + date;
data.remotepad2Build = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), date };
writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
