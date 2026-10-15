import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root=new URL('../',import.meta.url);
const read=file=>fs.readFile(new URL(file,root),'utf8');
const GUIDE='docs/MIGRATE-TO-2.0.md';

async function markdownFiles(){
 const top=(await fs.readdir(root)).filter(name=>name.endsWith('.md'));
 const docs=(await fs.readdir(new URL('docs/',root),{recursive:true})).filter(name=>name.endsWith('.md')).map(name=>'docs/'+name);
 return [...top,...docs].sort();
}

// Relative Markdown link targets of one file, resolved against the repository root, without anchors.
function relativeLinks(file,text){
 return [...text.matchAll(/\]\(([^)\s]+)\)/g)].map(match=>match[1])
  .filter(target=>!/^[a-z]+:/i.test(target)&&!target.startsWith('#'))
  .map(target=>path.posix.normalize(path.posix.join(path.posix.dirname(file),target.split('#')[0])));
}

test('the 2.0 migration guide is linked from the installation and release docs',async()=>{
 await fs.access(new URL(GUIDE,root));
 for(const file of ['docs/INSTALL-UNRAID.md','docs/RELEASES.md','CHANGELOG.md']){
  assert.ok(relativeLinks(file,await read(file)).includes(GUIDE),file+' links '+GUIDE);
 }
});

test('relative links in Markdown documents point to existing files',async()=>{
 for(const file of await markdownFiles()){
  for(const target of relativeLinks(file,await read(file))){
   await assert.doesNotReject(fs.access(new URL(target,root)),file+' -> '+target);
  }
 }
});

test('only the migration guide and historical records describe a separate Recovery container',async()=>{
 // Historical records: release history, recorded image digests, the decision record and the glossary's "avoid" list.
 const history=new Set([GUIDE,'CHANGELOG.md','docs/VERIFICATION.md','docs/adr/0001-recovery-runs-inside-review.md','GLOSSARY.md']);
 // .tdarr-recovery-status.json is the shared status file, not the image.
 const separate=/tdarr-recovery(?!-status)|Dockerfile\.recovery|RECOVERY_IMAGE_TAG|RECOVERY_DATA_HOST|--profile recovery|compose \w+ recovery\b/;
 for(const file of await markdownFiles()){
  if(history.has(file))continue;
  const line=(await read(file)).split('\n').find(text=>separate.test(text));
  assert.equal(line,undefined,file);
 }
});

test('the migration guide uses placeholders, not API keys',async()=>{
 // Radarr and Tdarr API keys are 32 hexadecimal characters.
 assert.doesNotMatch(await read(GUIDE),/\b[0-9a-f]{32}\b/i);
});

test('the guide\'s registry inspection prints key names and the frozen enabled flag, never values',async t=>{
 const {execFile}=await import('node:child_process');
 const os=await import('node:os');
 const script=/--entrypoint \/usr\/bin\/node \S+ -e '([^']+)' \/old/.exec(await read(GUIDE))?.[1];
 assert.ok(script,'inspection command');
 const run=dir=>new Promise((resolve,reject)=>execFile(process.execPath,['-e',script,dir],(error,stdout)=>error?reject(error):resolve(stdout)));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'migrate-inspect-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 assert.equal(await run(dir),'config.json: missing\nregistry: none\n');
 // Synthetic 1.11-style data; the secret-looking values must never reach the output.
 const config={enabled:true,radarrApiKey:'SECRET-KEY-VALUE',libraryId:'LIBRARY-VALUE',sourceRoot:'/media/movies',mediaRoot:'/storage/movies',quarantineRoot:'/storage/.tdarr-corrupt',reports:'/reports',maxRepairsPerDay:3};
 await fs.writeFile(path.join(dir,'config.json'),JSON.stringify(config));
 await fs.writeFile(path.join(dir,'pending-approvals.json'),JSON.stringify({version:1,config:{enabled:true,libraryId:'LIBRARY-VALUE',mediaRoot:'/storage/movies',maxRepairsPerDay:3},cases:[{id:'CASE-VALUE'}]}));
 const output=await run(dir);
 assert.equal(output,[
  'config.json enabled: true',
  'config.json keys using /storage or /reports: mediaRoot, quarantineRoot, reports',
  'registry frozen cases: 1',
  'registry frozen keys: enabled, libraryId, maxRepairsPerDay, mediaRoot',
  'registry frozen enabled: true',
  'registry frozen keys using /storage or /reports: mediaRoot',
 ''].join('\n'));
 await fs.writeFile(path.join(dir,'pending-approvals.json'),JSON.stringify({version:1,config:{libraryId:'LIBRARY-VALUE'},cases:[]}));
 assert.match(await run(dir),/^registry frozen enabled: not frozen$/m);
});
