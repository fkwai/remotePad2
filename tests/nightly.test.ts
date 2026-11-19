import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tempRoot } from './temp.ts';

test('nightly uses the validated dev tree while always fast-forwarding its own history', async () => {
  const root=await mkdtemp(path.join(tempRoot,'rp2-nightly-'));
  const git=(...args:string[])=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try {
    git('init','-b','dev');git('config','user.name','Test');git('config','user.email','test@example.invalid');
    await mkdir(path.join(root,'scripts'));
    await writeFile(path.join(root,'scripts/nightly-version.mjs'),await readFile(new URL('../scripts/nightly-version.mjs',import.meta.url)));
    await writeFile(path.join(root,'package.json'),JSON.stringify({name:'fixture',version:'1.2.3'}));
    git('add','.');git('commit','-m','dev baseline');
    let previous=git('rev-parse','HEAD');git('branch','nightly',previous);
    for (const value of ['first','second']) {
      await writeFile(path.join(root,'feature.txt'),value);git('add','feature.txt');git('commit','-m','dev '+value);
      const dev=git('rev-parse','HEAD');
      execFileSync(process.execPath,['scripts/nightly-version.mjs'],{cwd:root});
      git('add','package.json');const tree=git('write-tree');
      const next=git('commit-tree',tree,'-p',previous,'-p',dev,'-m','nightly');
      git('merge-base','--is-ancestor',previous,next); // publish can use a normal push, never force.
      assert.equal(git('show',next+':feature.txt'),value);
      const manifest=JSON.parse(git('show',next+':package.json'));
      assert.match(manifest.version,/^1\.2\.3-nightly\.\d{8}$/);assert.equal(manifest.remotepad2Build.source,dev);
      git('update-ref','refs/heads/nightly',next,previous);previous=next;
      git('restore','--source=HEAD','--staged','--worktree','package.json');
    }
  } finally {await rm(root,{recursive:true,force:true});}
});
