import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRecoveryAttention} from './recovery-attention.mjs';
import {createDiagnosticExport,diagnosticExportHeaders,DIAGNOSTIC_BLOCKERS} from './diagnostic-export.mjs';
import {ATTENTION_PATHS,now} from './test-helpers/attention-paths.mjs';

const make=(overview,extra={})=>createDiagnosticExport({data:'/nonexistent-synthetic-data',getOverview:typeof overview==='function'?overview:async()=>overview,version:()=>'0.0.0-test',now:()=>now,...extra});
const id='a'.repeat(24);

test('unknown service values and unexpected fields become fixed tokens, never text',async()=>{
 const record={...ATTENTION_PATHS['download queue failed'],tdarrStatus:'SENTINEL <script> /secret/path',phase:'manual',queue:[{status:'SENTINEL-STATUS',trackedDownloadState:'SENTINEL',title:'SENTINEL-RELEASE'}],search:{status:'SENTINEL-SEARCH',message:'SENTINEL-MESSAGE'},extra:{token:'SENTINEL-TOKEN'},title:'SENTINEL-TITLE'};
 const report=await make({requests:[record]}).report('recovery',id);
 const text=JSON.stringify(report);assert.doesNotMatch(text,/SENTINEL|secret|script/);
 assert.equal(report.observations.tdarr.state,'unrecognized');assert.equal(report.observations.radarr.state,'queue-present');
});

test('a malformed identifier or unknown source reads nothing; a case outside attention has no export',async()=>{
 let reads=0;const exporter=make(async()=>{reads++;return {requests:[ATTENTION_PATHS['stale status, not attention'],{...ATTENTION_PATHS['manual recovery case'],id:'e'.repeat(24)}]}});
 for(const [source,value] of [['recovery','../x'],['recovery',42],['sonarr',id],['recovery','A'.repeat(24)],[undefined,id]])assert.equal(await exporter.report(source,value),null);
 assert.equal(reads,0,'no read for a malformed request');
 assert.equal(await exporter.report('recovery',id),null,'a waiting case is not exported');
 assert.equal(await exporter.report('radarr','e'.repeat(24)),null,'the same ID under another source is another case');
});

test('an unreadable overview gives a truthful minimal report and a change while reading is never verified',async()=>{
 const minimal=await make(async()=>{throw Error('SENTINEL')}).report('recovery',id);
 assert.equal(minimal.completeness,'minimal');assert.equal(minimal.state.reason,'unknown');assert.equal(minimal.caseRecord,'unreadable');assert.doesNotMatch(JSON.stringify(minimal),/SENTINEL/);
 let n=0;const changing=make(async()=>({requests:[{...ATTENTION_PATHS['manual recovery case'],statusUpdated:new Date(now-1000*(++n)).toISOString()}]}));
 const report=await changing.report('recovery',id);assert.equal(report.caseRecord,'changed-during-read');assert.equal(report.observations.record.age,'unknown');assert.equal(report.observations.record.observedAt,null);
});

test('blockers follow the attention model and every attention reason is allowlisted',async()=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'diagnostic-export-'));
 try{
  const attention=createRecoveryAttention({data,getConfig:()=>({}),getItems:()=>({}),now:()=>now,tdarr:async()=>{throw Error('offline')},getConnection:async()=>{throw Error('offline')}});
  const overview=await attention.attach({requests:Object.values(ATTENTION_PATHS).map(r=>structuredClone(r))});
  for(const record of overview.requests.filter(r=>r.attention&&!r.sourceReplacement)){
   const expected=DIAGNOSTIC_BLOCKERS[record.attention.reason];assert.ok(expected,record.attention.reason);
   for(const code of expected)assert.ok(record.attention.blockers.includes(code),record.attention.reason+' blocker '+code);
  }
 }finally{await fs.rm(data,{recursive:true,force:true});}
 for(const [name,record] of Object.entries(ATTENTION_PATHS)){
  const report=await make({requests:[record]}).report(record.source==='recovery'?'recovery':'radarr',record.id);
  if(report===null)continue;assert.notEqual(report.state.reason,'unrecognized',name);assert.notEqual(report.state.phase,'unrecognized',name);
 }
});

test('attachment headers are private and carry a safe name',()=>{
 const h=diagnosticExportHeaders('recovery',id);assert.equal(h['cache-control'],'no-store');assert.match(h['content-disposition'],/^attachment; filename="[a-z0-9.-]+"$/);
});

test('a failed or skipped transcode claims no retry verdict: its follow-up is listed as unknown (#232)',async()=>{
 for(const name of ['replacement transcode error','replacement skipped as not required']){
  const record=ATTENTION_PATHS[name],report=await make({requests:[record]}).report('recovery',record.id);
  assert.ok(report,name);assert.ok(!report.blockers.includes('transcode-retry-unavailable'),name);assert.ok(report.unknown.includes('transcode-follow-up'),name);
 }
 const other=ATTENTION_PATHS['manual recovery case'];assert.ok(!(await make({requests:[other]}).report('recovery',other.id)).unknown.includes('transcode-follow-up'));
});
