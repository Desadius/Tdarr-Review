import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {classifyRecovery} from './public/review-model.js';
import {ATTENTION_PATHS,now} from './test-helpers/attention-paths.mjs';

// Every path by which a Recovery or Radarr request reaches Needs attention (#229), with the category,
// label, next step and warnings it gets. Pinned in fixtures/recovery-attention-golden.json from the
// code; UPDATE_GOLDEN=1 rewrites it. The attention model of #229 keys its reason on these paths.
const golden=new URL('../fixtures/recovery-attention-golden.json',import.meta.url);

test('every current path into Needs attention keeps its category, label, next step and warnings',async()=>{
 const actual=Object.fromEntries(Object.entries(ATTENTION_PATHS).map(([name,record])=>{const c=classifyRecovery(record,now);return [name,{category:c.category,label:c.label,nextStep:c.nextStep,warnings:c.warnings}];}));
 if(process.env.UPDATE_GOLDEN==='1'){await fs.writeFile(golden,JSON.stringify(actual,null,1)+'\n');return;}
 const expected=JSON.parse(await fs.readFile(golden,'utf8'));
 assert.deepEqual(Object.keys(actual),Object.keys(expected));
 for(const name of Object.keys(expected))assert.deepEqual(actual[name],expected[name],name);
});
