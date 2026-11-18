import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import Fastify from '../apps/server/node_modules/fastify/fastify.js';
import { registerFiles } from '../apps/server/src/files.ts';
import { previewKey, previewRequest } from '../apps/server/src/preview-access.ts';

test('folder listings, binary previews, sandbox headers and revision conflicts', async () => {
  const root = await mkdtemp('/Users/kuaifang/work/tmp/rp2-files-');
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
