export const sshTarget = new URLSearchParams(location.search).get('ssh') || '';
export const workspaceKey = (key: string) => 'rp2.' + (sshTarget ? encodeURIComponent(sshTarget) + '.' : '') + key;
export function workspaceUrl(url: string) {
  return sshTarget ? '/api/ssh/' + encodeURIComponent(sshTarget) + '/proxy/' + url.slice(5) : url;
}
export function workspaceSocket(path: string) {
  const prefix = sshTarget ? '/ws/ssh/' + encodeURIComponent(sshTarget) + path.slice(3) : path;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${prefix}`;
}
