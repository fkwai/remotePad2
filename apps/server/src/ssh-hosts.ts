import os from 'node:os';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
export const sshDestination = /^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/;

async function expand(pattern: string): Promise<string[]> {
  const absolute = path.resolve(pattern);
  if (!/[?*]/.test(absolute)) return [absolute];
  let directories = [path.parse(absolute).root];
  for (const segment of absolute.slice(path.parse(absolute).root.length).split(path.sep)) {
    if (!/[?*]/.test(segment)) {
      directories = directories.map((dir) => path.join(dir, segment));
      continue;
    }
    const match = new RegExp('^' + segment.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    const results = await Promise.all(directories.map(async (dir) => {
      const entries = await readdir(dir).catch(() => [] as string[]);
      return entries.sort().filter((name) => match.test(name)).map((name) => path.join(dir, name));
    }));
    directories = results.flat();
  }
  return directories;
}

/** Discover literal aliases only. OpenSSH remains responsible for resolving them. */
export async function sshConfigHosts(home = os.homedir()): Promise<string[]> {
  const aliases = new Set<string>();
  const seen = new Set<string>();
  async function read(file: string, depth: number): Promise<void> {
    if (depth > 16 || seen.has(file)) return;
    seen.add(file);
    const source = await readFile(file, 'utf8').catch(() => '');
    for (const line of source.split(/\r?\n/)) {
      const uncommented = line.replace(/("(?:[^"\\]|\\.)*"|'[^']*')|#.*$/g, (match, quoted) => quoted || '');
      const tokens = uncommented.match(/"(?:[^"\\]|\\.)*"|'[^']*'|[^\s#=]+/g) || [];
      const keyword = tokens.shift()?.toLowerCase();
      // Comments terminate outside quotes.
      const values = tokens.map((token) => token.replace(/^["']|["']$/g, ''));
      if (keyword === 'host') {
        for (const alias of values) if (sshDestination.test(alias)) aliases.add(alias);
      }
      if (keyword === 'include') {
        for (const value of values) {
          const resolved = value.startsWith('~/') ? path.join(home, value.slice(2))
            : path.isAbsolute(value) ? value : path.join(home, '.ssh', value);
          for (const included of await expand(resolved)) await read(included, depth + 1);
        }
      }
    }
  }
  await read(path.join(home, '.ssh', 'config'), 0);
  return [...aliases];
}
