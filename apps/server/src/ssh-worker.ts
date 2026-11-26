import {execFile} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

const run = promisify(execFile);
const archiveName = 'worker-binaries.tar.gz';
const maxArchiveSize = 24 * 1024 * 1024;

export async function goWorkerArchive(root: string, staging: string) {
  if (process.env.REMOTEPAD2_REMOTE_WORKER === 'node') return;
  const override = process.env.REMOTEPAD2_WORKER_ARCHIVE;
  let data: Buffer;
  if (override) {
    data = await readFile(override);
  } else {
    const {stdout} = await run('git', ['-C', root, 'rev-parse', 'HEAD:apps/worker'], {timeout: 2000});
    const tree = stdout.trim();
    if (!/^[a-f0-9]{40}$/.test(tree)) throw new Error('Invalid worker source revision.');
    const cache = path.join(os.homedir(), '.remotepad2', 'worker-downloads', tree);
    const archive = path.join(cache, archiveName);
    data = await readFile(archive).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      const response = await fetch(
        'https://github.com/fkwai/remotePad2/releases/download/worker-' + tree + '/' + archiveName,
        {signal: AbortSignal.timeout(15000)},
      );
      if (!response.ok || !response.body) throw new Error('Worker release download returned HTTP ' + response.status + '.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > maxArchiveSize) throw new Error('Worker archive exceeds 24 MB.');
        chunks.push(chunk);
      }
      const downloaded = Buffer.concat(chunks);
      await mkdir(cache, {recursive: true, mode: 0o700});
      const temporary = archive + '.' + randomUUID();
      try {
        await writeFile(temporary, downloaded, {flag: 'wx', mode: 0o600});
        await rename(temporary, archive);
      } finally {
        await rm(temporary, {force: true});
      }
      return downloaded;
    });
  }
  if (data.length === 0 || data.length > maxArchiveSize) throw new Error('Invalid worker archive size.');
  await writeFile(path.join(staging, archiveName), data, {mode: 0o600});
  return {
    name: archiveName,
    revision: createHash('sha256').update(data).digest('hex').slice(0, 20),
  };
}

export function goBootstrap(archive: string, channel: string, revision: string) {
  return `
    worker_arch=
    case "$(uname -s):$(uname -m)" in
      Linux:x86_64) worker_arch=amd64 ;;
      Linux:aarch64|Linux:arm64) worker_arch=arm64 ;;
    esac
    if [ -n "$worker_arch" ] && ! test -S "\${CODEX_HOME:-$HOME/.codex}/ipc/ipc.sock"; then
      echo 'REMOTEPAD2_PHASE=Preparing Go worker' >&2
      install="$HOME/.remotepad2/backend/${channel}/${revision}"
      binary="$install/worker"
      if ! test -x "$binary"; then
        mkdir -p "$install"
        stage=$(mktemp "$install/.worker.XXXXXXXX")
        trap 'rm -f "$stage"' EXIT
        tar -xOf - ${archive} | tar -xzOf - "worker-linux-$worker_arch" > "$stage"
        test -s "$stage"
        chmod 700 "$stage"
        mv -f "$stage" "$binary"
      else
        cat >/dev/null
      fi
      socketdir="/tmp/rp2-$(id -u)-${channel}-${revision}"
      mkdir -m 700 "$socketdir" 2>/dev/null || test -d "$socketdir"
      test ! -L "$socketdir" && test "$(stat -c %u "$socketdir")" = "$(id -u)" || exit 1
      chmod 700 "$socketdir"
      export REMOTEPAD2_WORKER_SOCKET="$socketdir/api.sock"
      export REMOTEPAD2_CHANNEL=${channel}
      if ! "$binary" -check; then
        echo 'REMOTEPAD2_PHASE=Starting Go worker' >&2
        nohup "$binary" >"$socketdir/backend.log" 2>&1 </dev/null &
        worker_ready=
        for attempt in 1 2 3 4 5 6 7 8 9 10; do
          if "$binary" -check 2>/dev/null; then worker_ready=1; break; fi
          sleep 1
        done
        if [ -z "$worker_ready" ]; then
          cat "$socketdir/backend.log" >&2
          exit 1
        fi
      fi
      printf '\\nREMOTEPAD2_UID=%s\\nREMOTEPAD2_REVISION=%s\\n' "$(id -u)" ${revision}
      exit 0
    fi
    echo 'REMOTEPAD2_PHASE=Using Node worker on this target' >&2
`;
}
