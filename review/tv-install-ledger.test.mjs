import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createTvInstallLedger} from './tv-install-ledger.mjs';
import {replaceChecked,recoverTransactions,observeRetainedIdentity} from './core.mjs';
import {identityOf} from '../recovery/file-identity.mjs';
const linuxOnly={skip:process.platform!=='linux'?'Requires Linux descriptor-relative reads and directory fsync':false};

async function fixture(t){
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'tv-ledger-')),quarantine=path.join(data,'tv-quarantine'),transactions=path.join(data,'transactions');
 await Promise.all([fs.mkdir(quarantine),fs.mkdir(transactions)]);let root=quarantine;
 const ledger=createTvInstallLedger({data,getQuarantineRoot:()=>root,syncFile:async()=>{},syncDirectory:async()=>{}});t.after(()=>fs.rm(data,{recursive:true,force:true}));
 return {data,quarantine,transactions,ledger,setRoot:value=>{root=value}};
}
const uuid=()=>`tv-${crypto.randomUUID()}.json`;
const validContext=()=>({version:1,itemId:'a'.repeat(24),snapshot:'c'.repeat(64),flowProofHash:'d'.repeat(64),jobEvidenceHash:'e'.repeat(64),approvedAt:new Date().toISOString(),seriesId:7,seriesTitle:'Synthetic Show',seriesType:'standard',episodeFileId:91,episodeIds:[910],episodes:[{id:910,seasonNumber:1,episodeNumber:2}],jobId:'fixture-job-81',policy:'individual',profile:'tv-strict-review-v1',reviewRevision:3,settingsGeneration:1,sourceBytes:17,resultBytes:11});
async function add(f,{name=uuid(),phase='complete',leaf='kept.mkv',context=validContext()}={}){
 const file=path.join(f.quarantine,leaf);await fs.writeFile(file,'retained-original');const stat=await fs.stat(file),fp=identityOf(stat),transaction=name;
 const record={id:crypto.randomUUID(),phase:'preparing',created:new Date().toISOString(),installedAt:new Date().toISOString(),installedFP:'1:2:11:4:5',installedHash:'a'.repeat(64),retainedRoot:f.quarantine,retainedLeaf:leaf,retainedPhase:'verified',retainedFP:fp,retainedHash:'b'.repeat(64),tvAudit:{version:1,transaction,context}};
 await fs.writeFile(path.join(f.transactions,name),JSON.stringify(record));await f.ledger.append({journal:path.join(f.transactions,name),record});record.phase=phase;await fs.writeFile(path.join(f.transactions,name),JSON.stringify(record));return record;
}

test('authenticated projection source pages exact journal references past 150 records with a stable EOF',linuxOnly,async t=>{
 const f=await fixture(t);for(let i=0;i<153;i++)await add(f,{leaf:`kept-${i}.mkv`});
 const first=await f.ledger.page({limit:50});assert.equal(first.items.length,50);assert.ok(first.nextCursor);assert.equal(first.complete,false);
 await add(f,{leaf:'appended-later.mkv'});
 let cursor=first.nextCursor,seen=first.items.length;
 while(cursor){const page=await f.ledger.page({limit:50,cursor});seen+=page.items.length;cursor=page.nextCursor;}
 assert.equal(seen,153,'new append is outside the pinned EOF');
 const page=await f.ledger.page({limit:1});assert.equal(page.items[0].verification,'recorded');assert.equal(page.items[0].series.title,'Synthetic Show');assert.equal(page.items[0].retained.current,process.platform==='linux'?'matches':'not_verifiable');
 assert.equal(page.items[0].installed.hashVerified,true);assert.equal(page.items[0].refresh.sonarr,'unknown');assert.equal(JSON.stringify(page).includes(f.quarantine),false);
});

test('missing and changed current roots are metadata-only; unsafe retained entries stay unsafe',linuxOnly,async t=>{
 const f=await fixture(t);await add(f);
 const alternate=path.join(f.data,'new-root');await fs.mkdir(alternate);f.setRoot(alternate);
 assert.equal((await f.ledger.page()).items[0].retained.current,'root_changed');
 f.setRoot('');assert.equal((await f.ledger.page()).items[0].retained.current,'root_unavailable');
 f.setRoot(f.quarantine);await fs.unlink(path.join(f.quarantine,'kept.mkv'));await fs.writeFile(path.join(f.data,'outside'),'changed-target');
 await fs.link(path.join(f.data,'outside'),path.join(f.quarantine,'kept.mkv'));
 assert.equal((await f.ledger.page()).items[0].retained.current,process.platform==='linux'?'unsafe':'not_verifiable');
});

test('GET page does not create an index and malformed/truncated index is surfaced',linuxOnly,async t=>{
 const f=await fixture(t);assert.deepEqual(await f.ledger.page(),{items:[],nextCursor:null,complete:true,knownRecords:0,limits:{pageRows:50,pageBytes:128*1024,indexBytes:64*1024*1024}});
 await assert.rejects(fs.stat(path.join(f.data,'tv-install-index.jsonl')),{code:'ENOENT'});
 await fs.writeFile(path.join(f.data,'tv-install-index.jsonl'),'not-json\n');
 const page=await f.ledger.page();assert.equal(page.complete,false);assert.equal(page.reason,'index_corrupt');assert.equal(page.nextCursor,null);
});

test('index append rejects hardlinks and refuses to repair malformed bytes',linuxOnly,async t=>{
 const f=await fixture(t),name=uuid(),record={id:crypto.randomUUID(),created:new Date().toISOString(),phase:'preparing',tvAudit:{version:1,transaction:name,context:validContext()}};
 await fs.writeFile(path.join(f.transactions,name),JSON.stringify(record));
 const index=path.join(f.data,'tv-install-index.jsonl');await fs.writeFile(index,'bad tail');
 await assert.rejects(f.ledger.append({journal:path.join(f.transactions,name),record}));
 assert.equal(await fs.readFile(index,'utf8'),'bad tail');
 await fs.rm(index);await fs.writeFile(index,'');await fs.link(index,path.join(f.data,'index-link'));
 await assert.rejects(f.ledger.append({journal:path.join(f.transactions,name),record}),/bezpečný/);
});

test('FIFO index, journal, and retained entries fail closed without blocking', {skip:process.platform!=='linux'}, async t=>{
 const f=await fixture(t),index=path.join(f.data,'tv-install-index.jsonl');
 execFileSync('mkfifo',[index]);
 const indexPage=await Promise.race([f.ledger.page(),new Promise((_,reject)=>setTimeout(()=>reject(Error('FIFO index read blocked')),500))]);
 assert.equal(indexPage.complete,false);assert.equal(indexPage.reason,'index_unsafe');await fs.unlink(index);
 const name=uuid(),record={id:crypto.randomUUID(),phase:'preparing',created:new Date().toISOString(),installedFP:'1:2:3:4:5',installedHash:'a'.repeat(64),retainedRoot:f.quarantine,retainedLeaf:'retained-pipe',retainedPhase:'verified',retainedFP:'1:2:3:4:5',retainedHash:'b'.repeat(64),tvAudit:{version:1,transaction:name,context:validContext()}};
 execFileSync('mkfifo',[path.join(f.transactions,name)]);await fs.writeFile(index,JSON.stringify({version:1,transaction:name,created:record.created})+'\n');
 const journalPage=await Promise.race([f.ledger.page(),new Promise((_,reject)=>setTimeout(()=>reject(Error('FIFO journal read blocked')),500))]);
 assert.equal(journalPage.items[0].verification,'unverified');assert.equal(journalPage.items[0].reason,'journal_unavailable');
 await fs.unlink(path.join(f.transactions,name));await fs.writeFile(path.join(f.transactions,name),JSON.stringify(record));
 execFileSync('mkfifo',[path.join(f.quarantine,'retained-pipe')]);
 const retainedPage=await Promise.race([f.ledger.page(),new Promise((_,reject)=>setTimeout(()=>reject(Error('FIFO retained observation blocked')),500))]);
 assert.equal(retainedPage.items[0].retained.current,'unsafe');
});

for(const failure of ['syncFile','syncDirectory'])test(`index ${failure} failure aborts before media mutation`,linuxOnly,async t=>{
 const f=await fixture(t),original=path.join(f.data,'source.mkv'),review=path.join(f.data,'result.mkv'),name=uuid(),journal=path.join(f.transactions,name);
 await fs.writeFile(original,'original episode');await fs.writeFile(review,'review result');const originalFP=identityOf(await fs.stat(original)),reviewFP=identityOf(await fs.stat(review));
 const context={...validContext(),sourceBytes:(await fs.stat(original)).size,resultBytes:(await fs.stat(review)).size},tvAudit={version:1,transaction:name,context};
 const ledger=createTvInstallLedger({data:f.data,[failure]:async()=>{throw Error('synthetic durability failure')}});
 await assert.rejects(replaceChecked({original,review,journal,originalFP,reviewFP,tvAudit,retainOriginal:{root:f.quarantine,path:path.join(f.quarantine,'kept.mkv')},beforeMediaMutation:record=>ledger.append({journal,record})}),/synthetic durability failure/);
 assert.equal(identityOf(await fs.stat(original)),originalFP);assert.equal(identityOf(await fs.stat(review)),reviewFP);assert.deepEqual(await fs.readdir(f.quarantine),[]);
 const record=JSON.parse(await fs.readFile(journal,'utf8'));assert.equal(record.phase,'aborted');assert.equal(record.installedFP,undefined);assert.deepEqual(await recoverTransactions(f.transactions),[]);
});

test('current observation distinguishes changed, missing, symlink and unreadable copies',linuxOnly,async t=>{
 const f=await fixture(t);await add(f);const leaf=path.join(f.quarantine,'kept.mkv');await fs.writeFile(leaf,'changed');assert.equal((await f.ledger.page()).items[0].retained.current,'changed');
 await fs.unlink(leaf);assert.equal((await f.ledger.page()).items[0].retained.current,'missing');await fs.symlink(path.join(f.data,'outside'),leaf);assert.equal((await f.ledger.page()).items[0].retained.current,'unsafe');
 await fs.unlink(leaf);await fs.writeFile(leaf,'unreadable');const fp=identityOf(await fs.stat(leaf));await fs.chmod(leaf,0);
 if(process.getuid()===0){
  await fs.chmod(f.data,0o755);await fs.chmod(f.quarantine,0o755);
  const code='import {observeRetainedIdentity} from '+JSON.stringify(new URL('./core.mjs',import.meta.url).href)+';console.log(await observeRetainedIdentity(...JSON.parse(process.argv[1])))';
  assert.equal(execFileSync(process.execPath,['--input-type=module','-e',code,JSON.stringify([f.quarantine,'kept.mkv',fp])],{uid:65534,gid:65534,encoding:'utf8'}).trim(),'inaccessible');
 }else assert.equal(await observeRetainedIdentity(f.quarantine,'kept.mkv',fp),'inaccessible');
});

test('duplicate, missing and incomplete references stay unverified and cursor tampering is refused',linuxOnly,async t=>{
 const f=await fixture(t);await add(f,{leaf:'one.mkv'});await add(f,{leaf:'two.mkv'});const first=await f.ledger.page({limit:1});
 await assert.rejects(f.ledger.page({cursor:first.nextCursor+'x'}),error=>error.status===400);
 const index=path.join(f.data,'tv-install-index.jsonl'),rows=(await fs.readFile(index,'utf8')).trim().split('\n');await fs.writeFile(index,rows[0]+'\n'+rows[0]+'\n');assert.equal((await f.ledger.page()).reason,'index_duplicate');
 await fs.writeFile(index,rows[0]+'\n');const name=JSON.parse(rows[0]).transaction;await fs.unlink(path.join(f.transactions,name));assert.equal((await f.ledger.page()).items[0].reason,'journal_unavailable');
 await fs.writeFile(path.join(f.transactions,name),JSON.stringify({id:crypto.randomUUID(),phase:'complete',tvAudit:{version:1,transaction:name,context:{version:1,seriesTitle:'/private/path'}}}));const page=await f.ledger.page();assert.equal(page.items[0].reason,'audit_context_incomplete');assert.equal(JSON.stringify(page).includes('/private/path'),false);
});

test('an indexed aborted attempt never claims installed bytes or proof',linuxOnly,async t=>{
 const f=await fixture(t);await add(f,{phase:'aborted'});const record=(await f.ledger.page()).items[0];assert.equal(record.phase,'aborted');assert.equal(record.resultBytes,11,'candidate size remains an explicitly recorded fact');assert.equal(record.installed.bytes,null);assert.equal(record.installed.identityVerified,false);assert.equal(record.installed.hashVerified,false);assert.equal(record.installedAt,null);
});

test('bounded series labels preserve ordinary slashes and Unicode without exposing absolute paths or addresses',linuxOnly,async t=>{
 const f=await fixture(t);let record;await assert.doesNotReject(async()=>{record=await add(f,{context:{...validContext(),seriesTitle:'Nip/Tuck · Žluťoučký'}})});assert.equal((await f.ledger.page()).items[0].series.title,'Nip/Tuck · Žluťoučký');
 for(const title of ['/private/marker','C:\\private\\marker','https://private.example/marker']){record.tvAudit.context.seriesTitle=title;await fs.writeFile(path.join(f.transactions,record.tvAudit.transaction),JSON.stringify(record));const page=await f.ledger.page();assert.equal(page.items[0].series.title,'');assert.equal(JSON.stringify(page).includes(title),false)}
});
