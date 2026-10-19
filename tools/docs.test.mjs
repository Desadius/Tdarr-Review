import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {OLD_RECOVERY_IMAGE} from './old-recovery-image.mjs';

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
 const separate=new RegExp(OLD_RECOVERY_IMAGE.source+/|--profile recovery|compose \w+ recovery\b/.source);
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

test('the guide\'s step 2 comparison ignores only the runtime state of an earlier 2.0 start',{skip:process.platform==='win32'&&'needs diff'},async t=>{
 const {execFile}=await import('node:child_process');
 const os=await import('node:os');
 const command=(await read(GUIDE)).split('\n').find(line=>line.startsWith('diff -rq '));
 assert.ok(command,'comparison command');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'migrate-diff-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const old=path.join(dir,'old'),copy=path.join(dir,'copy');
 const compare=()=>new Promise(resolve=>execFile('sh',['-c',command.replaceAll('/mnt/cache/appdata/tdarr-recovery/data',old).replaceAll('/mnt/cache/appdata/tdarr-review/data/recovery',copy)],(error,stdout)=>resolve(stdout)));
 for(const target of [old,copy]){
  await fs.mkdir(path.join(target,'cache'),{recursive:true});
  await fs.writeFile(path.join(target,'state.json'),'{"version":1}');
  await fs.writeFile(path.join(target,'cache','languages.json'),'{}');
 }
 await fs.writeFile(path.join(copy,'runtime-state.json'),'{"state":"off"}');
 assert.equal(await compare(),'');
 await fs.writeFile(path.join(copy,'state.json'),'{"version":2}');
 assert.match(await compare(),/state\.json/);
 await fs.writeFile(path.join(copy,'state.json'),'{"version":1}');
 await fs.rm(path.join(copy,'cache','languages.json'));
 assert.match(await compare(),/languages\.json/);
});

test('the config.json check before an update runs the start-up rules and prints no values',async t=>{
 const {execFile}=await import('node:child_process');
 const os=await import('node:os');
 const {pathToFileURL}=await import('node:url');
 const block=/--entrypoint \/usr\/bin\/node \S+ --input-type=module -e '([^']+)' \/check\/config\.json/.exec(await read('docs/CONFIGURATION.md'))?.[1];
 assert.ok(block,'check command');
 const image='"/recovery/recovery-authority.mjs"';assert.equal(block.split(image).length,2,'the script imports the image\'s Recovery authority once');
 const script=block.replace(image,JSON.stringify(pathToFileURL(new URL('recovery/recovery-authority.mjs',root).pathname).href));
 const run=file=>new Promise(resolve=>execFile(process.execPath,['--input-type=module','-e',script,file],(error,stdout)=>resolve({code:error?error.code:0,stdout})));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'config-check-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'config.json'),cfg=JSON.parse(await read('fixtures/recovery-config-1.11.json'));
 assert.deepEqual(await run(file),{code:1,stdout:'config.json: cannot be read (ENOENT)\n'});
 const {enabled,...withoutEnabled}=cfg;
 await fs.writeFile(file,JSON.stringify(withoutEnabled));
 assert.deepEqual(await run(file),{code:0,stdout:'verify: passes\nrepair: passes\n'});
 await fs.writeFile(file,JSON.stringify(cfg));
 assert.deepEqual(await run(file),{code:1,stdout:'verify: passes\nrepair: mode-conflict enabled in config.json disagrees with RECOVERY_MODE; remove it or make it match\n'});
 await fs.writeFile(file,JSON.stringify({...withoutEnabled,radarrApiKey:'SECRET-KEY-VALUE',stableMinutes:'SECRET-ten'}));
 const refused=await run(file);
 assert.equal(refused.code,1);assert.doesNotMatch(refused.stdout,/SECRET/);
 assert.match(refused.stdout,/^verify: invalid-config .*\(stableMinutes must be a number of 0 or more\)$/m);
});
