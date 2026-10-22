import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {classifyRecovery} from './public/review-model.js';

// Every path by which a Recovery or Radarr request reaches Needs attention (#229), with the category,
// label, next step and warnings it gets. Pinned in fixtures/recovery-attention-golden.json from the
// code; UPDATE_GOLDEN=1 rewrites it. The attention model of #229 keys its reason on these paths.
const now=Date.UTC(2026,9,22,12),fresh=new Date(now-60000).toISOString(),old=new Date(now-3600000).toISOString();
const id='a'.repeat(24),child='b'.repeat(24);
const recovery=fields=>({source:'recovery',id,title:'Synthetic film',statusUpdated:fresh,...fields});
const radarr=fields=>({source:'radarr',id,title:'Synthetic film',updated:fresh,...fields});
export const ATTENTION_PATHS={
 'binding failure, original confirmed':recovery({phase:'manual',bindingFailure:'import-missing',sourceConfirmed:true}),
 'binding failure, original not confirmed':recovery({phase:'manual',bindingFailure:'import-missing',sourceConfirmed:false}),
 'binding failure with another copy offered':recovery({phase:'manual',bindingFailure:'import-missing',sourceConfirmed:true,sourceReplacement:{snapshot:'c'.repeat(64)}}),
 'manual recovery case':recovery({phase:'manual',reason:'Interrupted holding; inspect journal before any retry'}),
 'manual Radarr request':radarr({phase:'manual'}),
 'original check did not confirm a fault':recovery({phase:'no_action',originalCheckKind:'unconfirmed'}),
 'fault confirmed in Verify':recovery({phase:'dry_run'}),
 'replacement transcoded, awaiting review':recovery({phase:'replacement_imported',tdarrStatus:'Transcode success'}),
 'replacement transcode error':recovery({phase:'replacement_imported',tdarrStatus:'Transcode error'}),
 'replacement skipped as not required':recovery({phase:'replacement_imported',tdarrStatus:'Not required'}),
 'replacement on hold in Tdarr':recovery({phase:'replacement_imported',tdarrStatus:'Hold'}),
 'follow-up case completed under a parent':recovery({phase:'replacement_imported',replacementFollowupId:child,replacementFollowup:{id:child,source:'recovery',phase:'no_action',originalCheckKind:'healthy',statusUpdated:fresh}}),
 'original outside the library for over 24 hours':recovery({phase:'waiting_replacement',verifyPausedStep:'replacement_request',originalOutsideLibrary:true,originalOutsideSince:new Date(now-25*3600000).toISOString()}),
 'search failed':recovery({phase:'waiting_replacement',search:{status:'failed'}}),
 'download queue failed':recovery({phase:'waiting_replacement',queue:[{status:'failed',title:'Release'}]}),
 'import blocked':recovery({phase:'waiting_replacement',queue:[{status:'completed',trackedDownloadState:'importBlocked',title:'Release'}]}),
 'case error':recovery({phase:'waiting_replacement',search:{status:'completed'},error:'Replacement file size does not match Radarr'}),
 'retention error':recovery({phase:'replacement_imported',tdarrStatus:'Queued',retentionError:'Retention identity changed'}),
 'stale status, not attention':recovery({phase:'waiting_replacement',search:{status:'completed'},statusUpdated:old}),
};
const golden=new URL('../fixtures/recovery-attention-golden.json',import.meta.url);

test('every current path into Needs attention keeps its category, label, next step and warnings',async()=>{
 const actual=Object.fromEntries(Object.entries(ATTENTION_PATHS).map(([name,record])=>{const c=classifyRecovery(record,now);return [name,{category:c.category,label:c.label,nextStep:c.nextStep,warnings:c.warnings}];}));
 if(process.env.UPDATE_GOLDEN==='1'){await fs.writeFile(golden,JSON.stringify(actual,null,1)+'\n');return;}
 const expected=JSON.parse(await fs.readFile(golden,'utf8'));
 assert.deepEqual(Object.keys(actual),Object.keys(expected));
 for(const name of Object.keys(expected))assert.deepEqual(actual[name],expected[name],name);
});
