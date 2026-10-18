import test from 'node:test';
import assert from 'node:assert/strict';
import {previewCodeVersion} from './preview-version.mjs';

test('diagnostic policy changes invalidate the renderer identity without changing other sources',async()=>{
 const sources=new Map(),read=file=>{if(!sources.has(file))sources.set(file,'synthetic source: '+file);return sources.get(file)};
 const initial=await previewCodeVersion(read);
 assert.equal(await previewCodeVersion(read),initial);
 sources.set('preview-diagnostics.mjs','synthetic stricter diagnostic policy');
 assert.notEqual(await previewCodeVersion(read),initial);
});

test('seek retry policy changes invalidate the renderer identity',async()=>{
 const sources=new Map(),read=file=>{if(!sources.has(file))sources.set(file,'synthetic source: '+file);return sources.get(file)};
 const initial=await previewCodeVersion(read);
 sources.set('av-preview.mjs','synthetic seek retry accepting one more decoder diagnostic');
 assert.notEqual(await previewCodeVersion(read),initial);
});

test('renderer identity reads real renderer sources and fails closed if diagnostics cannot be read',async()=>{
 assert.match(await previewCodeVersion(),/^[a-f0-9]{64}$/);
 await assert.rejects(previewCodeVersion(file=>{
  if(file==='preview-diagnostics.mjs')throw Error('diagnostic source unavailable');
  return 'synthetic renderer source';
 }),/diagnostic source unavailable/);
});

test('MPEG-2 initialization policy changes invalidate prepared comparisons',async()=>{
 const sources=new Map(),read=file=>{if(!sources.has(file))sources.set(file,'synthetic source: '+file);return sources.get(file)};
 const initial=await previewCodeVersion(read);
 for(const name of ['mpeg2-initialization.mjs','preview-validation.mjs']){
  const before=await previewCodeVersion(read);sources.set(name,'changed acceptance policy');assert.notEqual(await previewCodeVersion(read),before);
 }
});
