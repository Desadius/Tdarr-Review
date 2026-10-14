import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {REFUSED_EXIT} from '../recovery/recovery-mode.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));

// Copies what the Dockerfile's COPY lines put into the image, minus .dockerignore, into a temporary
// directory that stands in for the image root. Modules are then loaded from there, so Node's own
// resolution of every static import decides whether the image is complete.
async function stageImage(dockerfile){
 const image=await fs.mkdtemp(path.join(os.tmpdir(),'tdarr-image-'));
 const ignored=(await fs.readFile(path.join(root,'.dockerignore'),'utf8')).split('\n').map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
 // Docker excludes a path when it or one of its parent directories matches a pattern.
 const excluded=relative=>relative.split('/').some((_,i,parts)=>ignored.some(pattern=>path.posix.matchesGlob(parts.slice(0,i+1).join('/'),pattern)));
 for(const line of dockerfile.split('\n')){
  const words=line.trim().split(/\s+/);
  if(words[0]!=='COPY')continue;
  const args=words.slice(1);
  assert.ok(!args.some(arg=>arg.startsWith('--')),'Unsupported COPY flag in: '+line);
  const target=args.pop();
  for(const source of args){
   const from=path.join(root,source);
   const into=path.join(image,target.endsWith('/')&&!source.endsWith('/')?path.posix.join(target,path.posix.basename(source)):target);
   await fs.cp(from,into,{recursive:true,filter:file=>{const relative=path.relative(root,file).split(path.sep).join('/');return !excluded(relative);}});
  }
 }
 return image;
}

test('the image contains every local module the registry migration utility imports',async t=>{
 const image=await stageImage(await fs.readFile(path.join(root,'Dockerfile'),'utf8'));
 t.after(()=>fs.rm(image,{recursive:true,force:true}));
 const migration=await import(pathToFileURL(path.join(image,'tools/migrate-recovery-registry.mjs')).href);
 assert.equal(typeof migration.main,'function');
});

test('the image places the supervisor beside Review and the Recovery worker where the supervisor starts it',async t=>{
 const image=await stageImage(await fs.readFile(path.join(root,'Dockerfile'),'utf8'));
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'tdarr-image-data-'));
 t.after(()=>Promise.all([fs.rm(image,{recursive:true,force:true}),fs.rm(data,{recursive:true,force:true})]));
 const review=path.join(image,'review-app');
 await fs.access(path.join(review,'server.mjs'));
 const supervisor=await import(pathToFileURL(path.join(review,'supervisor.mjs')).href);
 assert.equal(typeof supervisor.supervise,'function');
 // The supervisor resolves the worker as ../recovery/worker.mjs from server.mjs. Without a
 // config.json the worker refuses, which it can only do once all of its imports have loaded.
 const worker=spawnSync(process.execPath,[path.join(review,'../recovery/worker.mjs')],{env:{...process.env,DATA_ROOT:data,RECOVERY_MODE:'verify'},encoding:'utf8',timeout:30000});
 assert.equal(worker.status,REFUSED_EXIT,worker.stderr);
 assert.match(worker.stderr,/^RECOVERY_REFUSED missing-config$/m);
 assert.deepEqual(await fs.readdir(data),[]);
});
