import os from 'node:os';
import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { FileEntry } from '@remotepad2/protocol';
const SKIP = new Set(['node_modules', '.git', 'dist', '.pnpm-store', '.cache']);
export function registerSearch(app: FastifyInstance) {
  app.get<{Querystring:{path?:string;q?:string;hidden?:string}}>('/api/search', async (req, reply) => {
    const query = (req.query.q || '').trim().toLowerCase();
    if (!query || query.length > 200) return reply.code(400).send({error:'Enter a file or folder name (up to 200 characters).'});
    const root = path.resolve(req.query.path || os.homedir());
    try { if (!(await stat(root)).isDirectory()) throw Error(); }
    catch { return reply.code(400).send({error:'Choose a searchable directory.'}); }
    const hits:FileEntry[]=[]; const queue=[root]; let visited=0, entries=0, truncated=false;
    const deadline=Date.now()+3000, hidden=req.query.hidden==='true';
    for(let index=0;index<queue.length;index++) {
      if(++visited>1500 || Date.now()>deadline || req.raw.destroyed) {truncated=true;break;}
      let children; try {children=await readdir(queue[index],{withFileTypes:true});} catch {continue;}
      children.sort((a,b)=>a.name.localeCompare(b.name));
      for(const child of children) {
        if(++entries>30000) {truncated=true;break;}
        if(SKIP.has(child.name)||(!hidden&&child.name.startsWith('.'))||(!child.isDirectory()&&!child.isFile())) continue;
        const full=path.join(queue[index],child.name);
        if(child.name.toLowerCase().includes(query)) hits.push({name:child.name,path:full,directory:child.isDirectory()});
        if(hits.length>=200){truncated=true;break;}
        if(child.isDirectory())queue.push(full); // dirents never traverse symlinks.
      }
      if(truncated)break;
    }
    return {path:root,hits,truncated};
  });
}
