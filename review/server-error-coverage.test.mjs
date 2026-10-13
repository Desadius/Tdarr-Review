import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {errorLiterals} from '../tools/error-literals.mjs';
import {createTranslator} from './public/i18n.js';

test('error literal collection handles quoted escapes, constructors, responses and excludes comments',()=>{
  const source=`// throw new Error('comment');
  /* respond(res,400,{error:'comment'}); */
  throw new Error('A\\'s error');
  throw Error("A second error");
  new ReviewSessionError('Session error',409);
  respond(res,409,{error:'Response error'});
  throw new Error('Prefix: '+details);
  const narration="throw new Error('fiction')";
  const unrelated='not an error';`;
  assert.deepEqual(errorLiterals(source).map(({value,concatenated})=>({value,concatenated})),[
    {value:"A's error",concatenated:false},{value:'A second error',concatenated:false},
    {value:'Session error',concatenated:false},{value:'Response error',concatenated:false},
    {value:'Prefix: ',concatenated:true}
  ]);
});

test('authored server error literals have an English translation',async()=>{
  const en=createTranslator('en'),missing=[];
  // These source diagnostics are already English. Keep an explicit allowlist
  // rather than guessing language from accents and missing unaccented Czech.
  const alreadyEnglish=new Set([
    'Unsupported Tdarr collection','Invalid Tdarr database response','Tdarr database API: ',
    'Artwork unavailable','Invalid artwork','Artwork response too large','Empty artwork response',
    'Artwork busy','Invalid artwork cache','Invalid artwork destination','Invalid Radarr metadata',
    'Invalid review path','Invalid time','invalid envelope','Invalid retention path','Symlink parent',
    'Unsafe retention file','Approval directory symlink','Approval evidence already exists',
    'Invalid approval evidence','Approved replacement changed; quarantine preserved',
    'Quarantine ownership mismatch','Quarantine file changed; preserved','Retention identity changed',
    'Radarr ','Invalid recovery status','Invalid recovery schema','Invalid Tdarr file binding',
    'Tdarr scan pending; handoff will be checked again.',
    'Unrecognized Tdarr state; handoff requires inspection.',
    'Queue acknowledgement pending; handoff will be checked again.'
  ]);
  let count=0;
  for(const file of (await fs.readdir(new URL('./',import.meta.url))).filter(name=>name.endsWith('.mjs')&&!name.includes('.test.')&&!/^test(?:-|\.)/.test(name)&&name!=='integration.mjs')){
    const source=await fs.readFile(new URL(file,import.meta.url),'utf8');
    for(const {value,concatenated,line} of errorLiterals(source)){
      count++;
      const sample=value+(concatenated?'translation-fixture':'');
      if(!alreadyEnglish.has(value)&&en(sample)===sample)missing.push({file,line,value,concatenated});
    }
  }
  assert.ok(count>100,'Error collection must cover the current server modules');
  assert.deepEqual(missing,[],'Add English catalog entries for new authored server errors');
});
