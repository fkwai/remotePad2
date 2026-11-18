import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

// A browser receives this capability through a same-origin API request. Keep it
// in the path so relative assets inside opaque sandbox frames retain it.
export const previewKey = randomUUID();
export function previewRequest(req: FastifyRequest) {
  return ['GET', 'HEAD'].includes(req.method) &&
    (req.url.startsWith('/api/preview/' + previewKey + '/') ||
      /^\/api\/ssh\/[^/]+\/proxy\/preview\//.test(req.url) && req.url.split('/proxy/preview/')[1]?.startsWith(previewKey + '/'));
}
