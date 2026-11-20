import { tempRoot } from './temp.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import Fastify from '../apps/server/node_modules/fastify/fastify.js';
import { registerFiles } from '../apps/server/src/files.ts';
import { previewKey, previewRequest } from '../apps/server/src/preview-access.ts';

test('folder listings, binary previews, sandbox headers and revision conflicts', async () => {
  const root = await mkdtemp(path.join(tempRoot, 'rp2-files-'));
  const app = Fastify();
  try {
    await registerFiles(app);
    const file = path.join(root, 'note.md');
    await writeFile(file, '# Original');
    await writeFile(path.join(root, 'pixel.png'), Buffer.from([137, 80, 78, 71, 0]));
    const listing = await app.inject('/api/files?path=' + encodeURIComponent(root));
    assert.equal(listing.json().entries.length, 2);
    const preview = await app.inject('/api/preview/' + previewKey + root + '/pixel.png');
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.headers['content-type'], 'image/png');
    assert.equal(preview.rawPayload.length, 5);
    assert.equal(preview.headers['content-security-policy'], 'sandbox allow-scripts allow-downloads');
    const original = (await app.inject('/api/file?path=' + encodeURIComponent(file))).json();
    await writeFile(file, '# External change');
    const save = await app.inject({ method: 'PUT', url: '/api/file', payload: { ...original, content: '# Mine' } });
    assert.equal(save.statusCode, 409);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test('opaque preview frames only bypass origin checks with their capability on read routes', () => {
  const allowed = (url: string, method = 'GET') => previewRequest({url, method} as any);
  assert.equal(allowed('/api/preview/' + previewKey + '/tmp/a.png'), true);
  assert.equal(allowed('/api/ssh/host/proxy/preview/' + previewKey + '/tmp/a.png'), true);
  assert.equal(allowed('/api/preview/wrong/tmp/a.png'), false);
  assert.equal(allowed('/api/file?path=' + previewKey), false);
  assert.equal(allowed('/api/preview/' + previewKey + '/tmp/a.png', 'PUT'), false);
});

test('Unix-socket health checks send their HTTP request and return the worker status', async () => {
  const { createServer } = await import('node:http');
  const { healthy } = await import('../apps/server/src/ssh.ts');
  const root = await mkdtemp(path.join(tempRoot, 'rp2-health-'));
  const socket = path.join(root, 'api.sock');
  let code = 200, requests = 0;
  const server = createServer((req, res) => { requests++; assert.equal(req.url, '/api/health'); setTimeout(() => { res.writeHead(code); res.end('{}'); }, 650); });
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  try {
    assert.equal(await healthy(socket), true);
    code = 503;
    assert.equal(await healthy(socket), false);
    assert.equal(requests, 2);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});

test('window profiles persist independently by machine and can forget default without ending shells', async () => {
  const { registerWindows } = await import('../apps/server/src/windows.ts');
  const home = await mkdtemp(path.join(tempRoot, 'rp2-windows-'));
  const app = Fastify(); await registerWindows(app, home);
  try {
    await app.inject({ method: 'PUT', url: '/api/windows/default', payload: { ssh:'', name:'Local', state: {'panel-sizes':'{}'} } });
    await app.inject({ method: 'PUT', url: '/api/windows/default', payload: { ssh:'cloudKuai', name:'Remote', state: {directory:'/root'} } });
    assert.equal((await app.inject('/api/windows')).json().windows.length, 2);
    await app.inject({ method:'DELETE',url:'/api/windows/default'});
    const rows=(await app.inject('/api/windows')).json().windows;
    assert.equal(rows.length,1); assert.equal(rows[0].ssh,'cloudKuai');
    assert.equal((await app.inject({method:'PUT',url:'/api/windows/bad',payload:{state:{a:42}}})).statusCode,400);
  } finally { await app.close(); await rm(home,{recursive:true,force:true}); }
});

test('filename search finds nested matches, honors hidden filter and skips dependency trees',async()=>{
  const {registerSearch}=await import('../apps/server/src/search.ts');
  const {mkdir}=await import('node:fs/promises');
  const root=await mkdtemp(path.join(tempRoot,'rp2-search-')); const app=Fastify();registerSearch(app);
  try{
    for(const dir of ['A/B','node_modules/pkg','.hidden'])await mkdir(path.join(root,dir),{recursive:true});
    for(const file of ['A/B/needle.txt','node_modules/pkg/needle.js','.hidden/needle.md'])await writeFile(path.join(root,file),'x');
    const url='/api/search?path='+encodeURIComponent(root)+'&q=needle';
    const visible=(await app.inject(url)).json();assert.deepEqual(visible.hits.map((row:any)=>row.name),['needle.txt']);
    const hidden=(await app.inject(url+'&hidden=true')).json();assert.deepEqual(hidden.hits.map((row:any)=>row.name).sort(),['needle.md','needle.txt']);
    assert.equal((await app.inject('/api/search?q=')).statusCode,400);
  }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
