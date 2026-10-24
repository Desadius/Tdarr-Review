import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSonarrSourceInspection} from './sonarr-source-inspection.mjs';

const revision='a'.repeat(64),settings={url:'http://127.0.0.1:8989/sonarr',apiKey:'private-key'};
const linuxOnly={skip:process.platform!=='linux'?'The isolated source worker checks the Linux container namespace':false};
const records={series:[{id:7,title:'Synthetic Show'}],files:[{id:31,seriesId:7,path:'/sonarr/tv/Show/E01.mkv',relativePath:'Show/E01.mkv',seasonNumber:1}],episodes:[{id:42,seriesId:7,episodeFileId:31,hasFile:true,seasonNumber:1,episodeNumber:1},{id:43,seriesId:7,episodeFileId:31,hasFile:true,seasonNumber:1,episodeNumber:2}]};
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
function fetchRecords(calls=[]){return async(url,options)=>{calls.push({url:new URL(url),options});const value=new URL(url).pathname.endsWith('/series')?records.series:new URL(url).pathname.endsWith('/episodefile')?records.files:records.episodes;return json(value);};}

test('a manual source check binds the exact selected file and emits only derived relative metadata',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sonarr-source-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'Show'),{recursive:true});await fs.writeFile(path.join(root,'Show','E01.mkv'),'synthetic');
 const calls=[],service=createSonarrSourceInspection({getSnapshot:async value=>({revision:value,sonarr:settings,tv:{sonarrRoot:'/sonarr/tv',mediaRoot:root}}),fetchFn:fetchRecords(calls)});t.after(()=>service.close());
 const result=await service.inspect(revision,7,31);
 assert.equal(result.status,'present');assert.equal(result.source,'unverified');assert.equal(result.relative,'Show/E01.mkv');assert.equal(result.size,9);
 assert.equal(JSON.stringify(result).includes(root),false);assert.equal(JSON.stringify(result).includes('/sonarr/tv'),false);assert.equal(JSON.stringify(result).includes('private-key'),false);
 assert.equal(calls.length,3);assert.ok(calls.every(({options})=>options.method==='GET'&&options.redirect==='error'));
});

test('the exact mapper refuses outside roots and Sonarr-ambiguous files before child execution',async t=>{
 const mismatch={...records,files:[{...records.files[0],path:'/sonarr/tv-old/Show/E01.mkv'}]};
 const service=createSonarrSourceInspection({getSnapshot:async value=>({revision:value,sonarr:settings,tv:{sonarrRoot:'/sonarr/tv',mediaRoot:'/tmp'}}),fetchFn:async url=>json(new URL(url).pathname.endsWith('/series')?mismatch.series:new URL(url).pathname.endsWith('/episodefile')?mismatch.files:mismatch.episodes)});t.after(()=>service.close());
 assert.deepEqual(await service.inspect(revision,7,31),{status:'unmapped',source:'unverified'});
});

test('a stale settings revision is rejected after the metadata read',async t=>{
 let count=0;const service=createSonarrSourceInspection({getSnapshot:async value=>({revision:++count>3?'b'.repeat(64):value,sonarr:settings,tv:{sonarrRoot:'/sonarr/tv',mediaRoot:'/tmp'}}),fetchFn:fetchRecords()});t.after(()=>service.close());
 await assert.rejects(service.inspect(revision,7,31),error=>error.code==='settings_conflict');
});

test('an upstream failure releases the whole-inspection gate for the next manual request',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sonarr-source-release-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const worker=path.join(root,'worker.mjs');await fs.writeFile(worker,"process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({status:'present',size:1,modifiedAt:1})+'\\n'));");
 let fail=true;const service=createSonarrSourceInspection({getSnapshot:async value=>({revision:value,sonarr:settings,tv:{sonarrRoot:'/sonarr/tv',mediaRoot:'/tmp'}}),fetchFn:async(...args)=>{if(fail){fail=false;throw Error('synthetic failure');}return fetchRecords()(...args);},workerPath:worker});t.after(()=>service.close());
 await assert.rejects(service.inspect(revision,7,31));assert.equal((await service.inspect(revision,7,31)).status,'present');
});

test('a timed-out real worker keeps its only slot until confirmed child exit', {skip:process.platform!=='linux'?'Signal/child lifecycle assertions require Linux':false}, async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sonarr-source-slot-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const worker=path.join(root,'slow-worker.mjs');
 await fs.writeFile(worker,`process.on('SIGTERM',()=>{});process.stdin.resume();setTimeout(()=>{process.stdout.write(JSON.stringify({status:'present',size:1,modifiedAt:1})+'\\n')},600);`);
 let spawns=0;const children=[];const service=createSonarrSourceInspection({getSnapshot:async value=>({revision:value,sonarr:settings,tv:{sonarrRoot:'/sonarr/tv',mediaRoot:'/tmp'}}),fetchFn:fetchRecords(),workerPath:worker,workerTimeoutMs:30,killGraceMs:250,shutdownMs:30,spawnChild:(...args)=>{spawns++;const child=spawn(...args);children.push(child);return child;}});
 const first=await service.inspect(revision,7,31);assert.equal(first.status,'unavailable');
 assert.equal((await service.inspect(revision,7,31)).status,'busy');
 const waitClosed=child=>child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('child did not close')),2000);child.once('close',()=>{clearTimeout(timer);resolve();});});
 await waitClosed(children[0]);
 assert.equal((await service.inspect(revision,7,31)).status,'unavailable','the second child can start only after the first child close event');assert.equal(spawns,2);
 await service.close();
 await waitClosed(children[1]);assert.equal(children[0].signalCode,'SIGKILL');assert.equal(children[1].signalCode,'SIGKILL');
});

test('an oversized child response fails closed without buffering more than the protocol cap', {skip:process.platform!=='linux'?'Child process pipe assertions require Linux':false},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sonarr-source-output-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const worker=path.join(root,'large-worker.mjs');await fs.writeFile(worker,"process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('x'.repeat(65536)));");
 let spawns=0;const service=createSonarrSourceInspection({getSnapshot:async value=>({revision:value,sonarr:settings,tv:{sonarrRoot:'/sonarr/tv',mediaRoot:'/tmp'}}),fetchFn:fetchRecords(),workerPath:worker,spawnChild:(...args)=>{spawns++;return spawn(...args);}});t.after(()=>service.close());
 assert.equal((await service.inspect(revision,7,31)).status,'unavailable');assert.equal(spawns,1);
});

test('a worker that exits before accepting its bounded input fails closed without an unhandled pipe error',{skip:process.platform!=='linux'?'Child process pipe assertions require Linux':false},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sonarr-source-early-exit-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const worker=path.join(root,'early-exit.mjs');await fs.writeFile(worker,'process.exit(0);');
 const service=createSonarrSourceInspection({getSnapshot:async value=>({revision:value,sonarr:settings,tv:{sonarrRoot:'/sonarr/tv',mediaRoot:'/tmp'}}),fetchFn:fetchRecords(),workerPath:worker});t.after(()=>service.close());
 assert.equal((await service.inspect(revision,7,31)).status,'unavailable');
});
