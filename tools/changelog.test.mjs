import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {readFragments,changelogProblems,unreleasedEntries,upgradeNotes,release} from './changelog.mjs';

const CHANGELOG='# Change history\n\nIntro.\n\n## Unreleased\n\n- Older entry written directly.\n\n## 2.0.0 — 2026-10-15\n\n- Released entry.\n';
async function repo(fragments={},changelog=CHANGELOG){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'changelog-'));
 await fs.mkdir(path.join(root,'changelog.d'));await fs.mkdir(path.join(root,'docs'));
 await fs.writeFile(path.join(root,'docs','GUIDE.md'),'# Guide\n');await fs.writeFile(path.join(root,'CHANGELOG.md'),changelog);
 await fs.writeFile(path.join(root,'changelog.d','README.md'),'# Fragments\n');
 for(const [name,text] of Object.entries(fragments))await fs.writeFile(path.join(root,'changelog.d',name),text);
 return {root,cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}

test('fragments are read in issue order and assembled after the entries already in Unreleased',async()=>{
 const r=await repo({'161-approve-only.md':'- Approve without replacing.\n','24-old.md':'- Fix from issue 24, see [the guide](docs/GUIDE.md).\n','161-another.md':'- Second change for 161\n  wrapped onto two lines.\n'});
 try{
  assert.deepEqual((await readFragments(r.root)).map(f=>f.name),['24-old.md','161-another.md','161-approve-only.md']);
  assert.deepEqual(unreleasedEntries(await fs.readFile(path.join(r.root,'CHANGELOG.md'),'utf8'),await readFragments(r.root)),['- Older entry written directly.','- Fix from issue 24, see [the guide](docs/GUIDE.md).','- Second change for 161\n  wrapped onto two lines.','- Approve without replacing.']);
  assert.deepEqual(await changelogProblems(r.root),[]);
 }finally{await r.cleanup()}
});

test('malformed fragments are refused with the file and the reason',async()=>{
 const r=await repo({'approve.md':'- No issue number.\n','12-empty.md':'\n','13-two.md':'- One.\n- Two.\n','14-plain.md':'Not a list item.\n','15-conflict.md':'<<<<<<< HEAD\n- A\n=======\n- B\n>>>>>>> branch\n','16-link.md':'- See [missing](docs/MISSING.md).\n','17-notes.txt':'- Wrong extension.\n','18-two.upgrade.md':'- One.\n- Two.\n','19-x.upgrade.txt':'- Wrong extension.\n'});
 try{
  assert.deepEqual(await changelogProblems(r.root),[
   'changelog.d/12-empty.md: a fragment is one Markdown list item starting with "- "',
   'changelog.d/13-two.md: a fragment holds exactly one list item',
   'changelog.d/14-plain.md: a fragment is one Markdown list item starting with "- "',
   'changelog.d/15-conflict.md: contains a merge conflict marker',
   'changelog.d/16-link.md: link target docs/MISSING.md does not exist (links are relative to the repository root, as in CHANGELOG.md)',
   'changelog.d/17-notes.txt: name must be <issue>-<topic>.md or <issue>-<topic>.upgrade.md, for example 174-changelog-fragments.md',
   'changelog.d/18-two.upgrade.md: a fragment holds exactly one list item',
   'changelog.d/19-x.upgrade.txt: name must be <issue>-<topic>.md or <issue>-<topic>.upgrade.md, for example 174-changelog-fragments.md',
   'changelog.d/approve.md: name must be <issue>-<topic>.md or <issue>-<topic>.upgrade.md, for example 174-changelog-fragments.md',
  ]);
 }finally{await r.cleanup()}
});

test('a release moves Unreleased entries and fragments under the release heading and removes the fragments',async()=>{
 const r=await repo({'161-approve-only.md':'- Approve without replacing.\n','24-old.md':'- Fix from issue 24.\n'});
 try{
  await release(r.root,{version:'2.1.0',date:'2026-10-20'});
  assert.equal(await fs.readFile(path.join(r.root,'CHANGELOG.md'),'utf8'),'# Change history\n\nIntro.\n\n## Unreleased\n\n## 2.1.0 — 2026-10-20\n\n- Older entry written directly.\n\n- Fix from issue 24.\n\n- Approve without replacing.\n\n## 2.0.0 — 2026-10-15\n\n- Released entry.\n');
  assert.deepEqual(await fs.readdir(path.join(r.root,'changelog.d')),['README.md']);
 }finally{await r.cleanup()}
});

test('upgrade notes are read apart from the changes and a release puts them under "Before updating" first',async()=>{
 const r=await repo({'161-approve-only.md':'- Approve without replacing.\n','161-apply.upgrade.md':'- **Apply clears saved reviews.** Finish them first.\n','24-config.upgrade.md':'- **Check config.json first.** See [the guide](docs/GUIDE.md).\n'});
 try{
  const fragments=await readFragments(r.root);
  assert.deepEqual(unreleasedEntries(await fs.readFile(path.join(r.root,'CHANGELOG.md'),'utf8'),fragments),['- Older entry written directly.','- Approve without replacing.']);
  assert.deepEqual(upgradeNotes(fragments),['- **Check config.json first.** See [the guide](docs/GUIDE.md).','- **Apply clears saved reviews.** Finish them first.']);
  assert.deepEqual(await changelogProblems(r.root),[]);
  await release(r.root,{version:'2.1.0',date:'2026-10-20'});
  assert.equal(await fs.readFile(path.join(r.root,'CHANGELOG.md'),'utf8'),'# Change history\n\nIntro.\n\n## Unreleased\n\n## 2.1.0 — 2026-10-20\n\n### Before updating\n\n- **Check config.json first.** See [the guide](docs/GUIDE.md).\n\n- **Apply clears saved reviews.** Finish them first.\n\n### Changes\n\n- Older entry written directly.\n\n- Approve without replacing.\n\n## 2.0.0 — 2026-10-15\n\n- Released entry.\n');
  assert.deepEqual(await fs.readdir(path.join(r.root,'changelog.d')),['README.md']);
 }finally{await r.cleanup()}
 const only=await repo({'7-note.upgrade.md':'- **Back up /data.**\n'},CHANGELOG.replace('- Older entry written directly.\n\n',''));
 try{
  await release(only.root,{version:'2.1.1',date:'2026-10-21'});
  assert.match(await fs.readFile(path.join(only.root,'CHANGELOG.md'),'utf8'),/## 2\.1\.1 — 2026-10-21\n\n### Before updating\n\n- \*\*Back up \/data\.\*\*\n\n## 2\.0\.0/);
 }finally{await only.cleanup()}
});

test('npm run changelog prints the upgrade notes ahead of the changes',async()=>{
 const r=await repo({'5-a.md':'- Change.\n','5-a.upgrade.md':'- **Note.**\n'});
 try{
  await fs.mkdir(path.join(r.root,'tools'));await fs.copyFile(new URL('./changelog.mjs',import.meta.url),path.join(r.root,'tools','changelog.mjs'));
  const result=spawnSync(process.execPath,[path.join(r.root,'tools','changelog.mjs')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout,'## Unreleased\n\n### Before updating\n\n- **Note.**\n\n### Changes\n\n- Older entry written directly.\n\n- Change.\n');
 }finally{await r.cleanup()}
});

test('a release refuses a bad version or date, malformed fragments, an existing heading and an empty release, changing nothing',async()=>{
 for(const [fragments,options,error] of [
  [{'1-a.md':'- A.\n'},{version:'2.1',date:'2026-10-20'},/version/],
  [{'1-a.md':'- A.\n'},{version:'2.1.0',date:'20.10.2026'},/date/],
  [{'1-a.md':'- A.\n','2-b.md':'- B.\n- C.\n'},{version:'2.1.0',date:'2026-10-20'},/2-b\.md/],
  [{'1-a.md':'- A.\n'},{version:'2.0.0',date:'2026-10-20'},/already/],
 ]){
  const r=await repo(fragments);try{
   await assert.rejects(release(r.root,options),error);
   assert.equal(await fs.readFile(path.join(r.root,'CHANGELOG.md'),'utf8'),CHANGELOG);assert.equal((await fs.readdir(path.join(r.root,'changelog.d'))).length,Object.keys(fragments).length+1);
  }finally{await r.cleanup()}
 }
 const empty=await repo({},CHANGELOG.replace('- Older entry written directly.\n\n',''));try{await assert.rejects(release(empty.root,{version:'2.1.0',date:'2026-10-20'}),/nothing to release/);}finally{await empty.cleanup()}
});

test('two pull requests that add fragments merge without a conflict in either order; editing CHANGELOG.md conflicts',{skip:spawnSync('git',['--version']).status!==0?'git is not available':false},async()=>{
 const r=await repo();
 const git=(...args)=>{const result=spawnSync('git',['-c','user.name=fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false',...args],{cwd:r.root,encoding:'utf8'});return result.status;};
 try{
  assert.equal(git('init','-q','-b','main'),0);git('add','-A');git('commit','-q','-m','base');
  for(const [branch,file] of [['a','161-approve-only.md'],['b','163-side-panel.md']]){git('checkout','-q','-b',branch,'main');await fs.writeFile(path.join(r.root,'changelog.d',file),'- Change '+branch+'.\n');git('add','-A');git('commit','-q','-m',branch);}
  for(const [first,second] of [['a','b'],['b','a']]){
   git('checkout','-q','-B','try-'+first,'main');assert.equal(git('merge','-q','--no-edit',first),0);assert.equal(git('merge','-q','--no-edit',second),0,'fragments merge cleanly');
  }
  for(const branch of ['c','d']){git('checkout','-q','-b',branch,'main');const text=await fs.readFile(path.join(r.root,'CHANGELOG.md'),'utf8');await fs.writeFile(path.join(r.root,'CHANGELOG.md'),text.replace('## Unreleased\n\n','## Unreleased\n\n- Entry '+branch+'.\n\n'));git('commit','-q','-am',branch);}
  git('checkout','-q','-B','try-direct','main');git('merge','-q','--no-edit','c');assert.notEqual(git('merge','-q','--no-edit','d'),0,'direct edits of Unreleased conflict');git('merge','--abort');
 }finally{await r.cleanup()}
});

test('the repository fragments are valid',async()=>{
 assert.deepEqual(await changelogProblems(path.resolve('.')),[]);
});
