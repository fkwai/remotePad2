// A lane owns its worker and PTYs even when two lanes have identical code.
export function remoteRuntime(revision: string, lane = process.env.REMOTEPAD2_CHANNEL || 'dev') {
  if (!['main', 'dev', 'nightly'].includes(lane)) throw new Error('Invalid RemotePad channel.');
  if (!/^[a-f0-9]{20}$/.test(revision)) throw new Error('Invalid backend revision.');
  return {
    channel: lane,
    install: `.remotepad2/backend/${lane}/${revision}`,
    socketDirectory: `/tmp/rp2-$(id -u)-${lane}-${revision}`,
  };
}
