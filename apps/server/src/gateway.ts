import { createServer, request, type IncomingMessage } from 'node:http';
import { createConnection } from 'node:net';
export const channels = ['main', 'dev', 'nightly'] as const;
export type Channel = typeof channels[number];
export function channelPath(url: string) {
  const match = url.match(/^\/(main|dev|nightly)(?=\/|\?|$)(.*)$/);
  return match ? { channel: match[1] as Channel, path: (match[2]?.startsWith('?') ? '/' : '') + (match[2] || '/') } : undefined;
}
interface GatewayOptions {
  socket: (channel: Channel) => string;
  statuses: () => Promise<unknown>;
  start: (channel: Channel) => Promise<unknown>;
}
function allowed(req: IncomingMessage) {
  const host = req.headers.host || '';
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return false;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')) return false;
  const opaquePreview = ['GET', 'HEAD'].includes(req.method || '') && /^\/(main|dev|nightly)\/api\/(preview\/|ssh\/[^/]+\/proxy\/preview\/)/.test(req.url || '');
  return opaquePreview || ((!req.headers.origin || req.headers.origin === 'http://' + host) && req.headers['sec-fetch-site'] !== 'cross-site');
}
export function createGateway(options: GatewayOptions) {
  const server = createServer(async (req, res) => {
    const json = (code: number, body: unknown) => { if (!res.headersSent) res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (!allowed(req)) return json(403, { error: 'Open the local RemotePad2 gateway.' });
    if (req.method === 'GET' && (req.url === '/' || req.url?.startsWith('/?'))) {
      res.writeHead(302, { location: '/main/' + (req.url?.slice(1) || '') }); res.end(); return;
    }
    if (req.method === 'GET' && req.url === '/_gateway/lanes') { try { return json(200, await options.statuses()); } catch { return json(500, { error: 'Could not read lane status.' }); } }
    const start = req.url?.match(/^\/_gateway\/lanes\/(main|dev|nightly)\/start$/);
    if (req.method === 'POST' && start) {
      try { return json(202, await options.start(start[1] as Channel)); } catch (error) { return json(409, { error: (error as Error).message }); }
    }
    const target = channelPath(req.url || '');
    if (!target) return json(404, { error: 'Choose /main/, /dev/ or /nightly/.' });
    if (req.url?.split('?')[0] === '/' + target.channel) { res.writeHead(302, { location: '/' + target.channel + '/' + (req.url.includes('?') ? '?' + req.url.split('?').slice(1).join('?') : '') }); res.end(); return; }
    const upstream = request({ socketPath: options.socket(target.channel), path: target.path, method: req.method, headers: req.headers }, (reply) => {
      res.writeHead(reply.statusCode || 502, reply.headers); reply.pipe(res);
    });
    upstream.on('error', () => {
      if (target.path === '/' && req.method === 'GET' && req.headers.accept?.includes('text/html')) {
        res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>RemotePad2</title><style>body{font:14px/1.7 system-ui;background:#151719;color:#dee3e7;max-width:540px;margin:12vh auto;padding:24px}a,button{color:#a6d3b4}button{background:#25332b;border:1px solid #41494f;padding:8px 12px;cursor:pointer}nav{display:flex;gap:24px}pre{white-space:pre-wrap}</style><h2>RemotePad2</h2><nav><a href="/main/">main</a><a href="/dev/">dev</a><a href="/nightly/">nightly</a></nav><p>${target.channel} is stopped.</p><button id="start">Start ${target.channel}</button><pre id="status"></pre><script>const status=document.getElementById('status');document.getElementById('start').onclick=async function(){this.disabled=true;try{const r=await fetch('/_gateway/lanes/${target.channel}/start',{method:'POST'});const d=await r.json();if(!r.ok)throw Error(d.error);const timer=setInterval(async()=>{const data=await(await fetch('/_gateway/lanes')).json();const lane=data.lanes.find(x=>x.name==='${target.channel}');status.textContent=lane.phase+(lane.error?' · '+lane.error:'');if(lane.alive){clearInterval(timer);location.reload()}else if(lane.phase==='Failed'){clearInterval(timer);this.disabled=false}},1000)}catch(e){status.textContent=e.message;this.disabled=false}}</script>`);
      } else json(503, { error: target.channel + ' is not running. Start it from Versions or run pnpm lanes start ' + target.channel + '.' });
    });
    req.on('aborted', () => upstream.destroy()); res.on('close', () => upstream.destroy()); req.pipe(upstream);
  });
  server.on('upgrade', (req, client, head) => {
    const target = channelPath(req.url || '');
    if (!allowed(req) || !target) { client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const upstream = createConnection(options.socket(target.channel));
    upstream.on('connect', () => {
      const headers = req.rawHeaders.flatMap((value, index) => index % 2 ? [] : [value + ': ' + req.rawHeaders[index + 1]]).join('\r\n');
      upstream.write(`${req.method} ${target.path} HTTP/1.1\r\n${headers}\r\n\r\n`);
      if (head.length) upstream.write(head); upstream.pipe(client); client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy()); client.on('close', () => upstream.destroy()); upstream.on('close', () => client.destroy());
  });
  return server;
}
