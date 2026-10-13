import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {ERROR_MESSAGES,errorText} from './public/error-messages.js';
import {apiError} from './routes/http.mjs';
import {createTranslator} from './public/i18n.js';

const en=createTranslator('en');
const slots=text=>[...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
const sources=async()=>{
 const files=['./server.mjs',...(await fs.readdir(new URL('./routes/',import.meta.url))).filter(f=>f.endsWith('.mjs')).map(f=>'./routes/'+f)];
 return Promise.all(files.map(async file=>[file,await fs.readFile(new URL(file,import.meta.url),'utf8')]));
};

test('every error code has Czech and English text with the same placeholders',()=>{
 assert.ok(Object.keys(ERROR_MESSAGES).length>=30);
 for(const [code,message] of Object.entries(ERROR_MESSAGES)){
  assert.match(code,/^[a-z][a-z0-9_]*$/,code);
  assert.ok(message.cs&&message.en&&message.cs!==message.en,code);
  assert.deepEqual(slots(message.en),slots(message.cs),code);
  // Older clients and thrown-error fallbacks translate the Czech text; keep both paths identical.
  assert.equal(en(message.cs),message.en,code);
 }
});

test('error bodies carry the code, optional params and the Czech fallback text',()=>{
 assert.deepEqual(apiError('item_changed'),{code:'item_changed',error:'Položka se změnila. Obnov přehled.'});
 assert.deepEqual(apiError('busy',{seconds:5}),{code:'busy',params:{seconds:5},error:'Právě probíhá jiná akce.'});
 assert.equal(errorText('item_changed',{},'en'),ERROR_MESSAGES.item_changed.en);
 assert.equal(errorText('item_changed',{},'de'),ERROR_MESSAGES.item_changed.cs,'unknown language falls back to Czech');
 assert.equal(errorText('no_such_code'),null);assert.equal(errorText('__proto__'),null);
 assert.equal(apiError('no_such_code').error,'no_such_code');
});

test('routes answer with known codes, never with literal error text',async()=>{
 for(const [file,source] of await sources()){
  assert.doesNotMatch(source,/\{error:'[^']*'\}/,file+' still returns a literal error');
  for(const [,code] of source.matchAll(/apiError\('([a-z0-9_]+)'/g))assert.ok(Object.hasOwn(ERROR_MESSAGES,code),file+': '+code);
  for(const ternary of source.matchAll(/apiError\([^()]*\?'([a-z0-9_]+)':'([a-z0-9_]+)'\)/g))for(const code of ternary.slice(1))assert.ok(Object.hasOwn(ERROR_MESSAGES,code),file+': '+code);
 }
});

test('the UI renders a known code in its language and falls back to the server text',async()=>{
 const app=await fs.readFile(new URL('./public/app.js',import.meta.url),'utf8');
 assert.match(app,/const serverError=d=>\(typeof d\?\.code==='string'&&errorText\(d\.code,d\.params,language\)\)\|\|d\?\.error;/);
 assert.match(app,/Error\(serverError\(d\)\|\|'Požadavek selhal\.'\)/);
 const assets=await fs.readFile(new URL('./routes/static.mjs',import.meta.url),'utf8');assert.ok(assets.includes("'/error-messages.js':['error-messages.js'"));
});

import {ReviewSessionError,createReviewSessionStore} from './review-session.mjs';
test('review-session errors carry a code and keep their Czech message; plain text still works',()=>{
 const coded=new ReviewSessionError('review_saved_elsewhere',409);
 assert.equal(coded.code,'review_saved_elsewhere');assert.equal(coded.status,409);assert.equal(coded.message,ERROR_MESSAGES.review_saved_elsewhere.cs);
 const plain=new ReviewSessionError('Nějaký jiný text.',400);assert.equal(plain.code,undefined);assert.equal(plain.message,'Nějaký jiný text.');
});

test('every thrown review error uses a known code, and the handler answers with it',async()=>{
 const read=file=>fs.readFile(new URL(file,import.meta.url),'utf8');
 for(const file of ['./server.mjs','./review-session.mjs']){
  const source=await read(file);
  for(const [,arg] of source.matchAll(/(?:new ReviewSessionError|\bfail)\(([^,)]+)/g)){
   if(!/^'/.test(arg))continue;
   const code=arg.slice(1,-1);assert.ok(Object.hasOwn(ERROR_MESSAGES,code),file+': '+arg);
  }
  assert.doesNotMatch(source,/(?:new ReviewSessionError|\bfail)\(`/,file+' builds an error message from a template');
 }
 const server=await read('./server.mjs');
 assert.match(server,/respond\(res,status,e instanceof ReviewSessionError&&e\.code\?apiError\(e\.code,e\.params\):\{error:e\.message\}\)/);
});

test('a real review-session validation error reaches the client as a code',async()=>{
 const state={items:{},reviewSessions:{}},store=createReviewSessionStore({getState:()=>state,save:async()=>{},verify:async()=>{throw Error('not reached')}});
 await assert.rejects(store.write('a'.repeat(24),null),error=>error instanceof ReviewSessionError&&error.code==='review_request_not_object'&&error.message===ERROR_MESSAGES.review_request_not_object.cs);
});
