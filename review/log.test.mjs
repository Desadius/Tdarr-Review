import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {formatEvent,logEvent} from './log.mjs';

const NOW=new Date('2026-10-13T12:00:00Z');

test('each event is one JSON line with time, source and event name',()=>{
 const line=formatEvent('action.finished',{action:'approve',id:'a'.repeat(24),title:'Film (2020)',outcome:'success',savedBytes:123},NOW);
 assert.ok(!line.includes('\n'));
 assert.deepEqual(JSON.parse(line),{action:'approve',id:'a'.repeat(24),title:'Film (2020)',outcome:'success',savedBytes:123,time:'2026-10-13T12:00:00.000Z',source:'review',event:'action.finished'});
 assert.equal(JSON.parse(formatEvent('x',{event:'spoofed',time:'old',source:'other'},NOW)).event,'x','fields cannot override the envelope');
});

test('secret-looking fields are never written, at any depth',()=>{
 const line=formatEvent('radarr-settings.saved',{url:'http://radarr:7878',apiKey:'SECRET1',nested:{radarrApiKey:'SECRET2',token:'SECRET3',password:'SECRET4',items:[{cookie:'SECRET5',authorization:'SECRET6',ok:1}]},reviewSession:{checks:'SECRET7'},accessKey:'SECRET8'},NOW);
 assert.doesNotMatch(line,/SECRET/);
 assert.deepEqual(JSON.parse(line).nested,{items:[{ok:1}]});
});

test('long strings, deep objects and large arrays are bounded; undefined fields are dropped',()=>{
 const parsed=JSON.parse(formatEvent('request.error',{message:'x'.repeat(2000),deep:{a:{b:{c:{d:{e:1}}}}},list:Array.from({length:50},(_,i)=>i),missing:undefined,big:10n},NOW));
 assert.equal(parsed.message.length,501);assert.ok(parsed.message.endsWith('…'));
 assert.equal(parsed.deep.a.b.c,'[nested]');assert.equal(parsed.list.length,20);assert.ok(!('missing' in parsed));assert.equal(parsed.big,'10');
});

test('logging never throws into the action that logs',()=>{
 assert.doesNotThrow(()=>logEvent('x',{},()=>{throw Error('stdout closed')}));
 const circular={};circular.self=circular;const lines=[];
 logEvent('x',{circular},line=>lines.push(line));assert.equal(lines.length,1);
});

test('Review logs approvals, rejections, replacements, batches, settings, node pauses/resumes, transactions and request errors',async()=>{
 const read=file=>fs.readFile(new URL(file,import.meta.url),'utf8');
 const server=await read('./server.mjs'),routes=(await Promise.all(['./routes/settings.mjs','./routes/previews.mjs','./routes/library.mjs'].map(read))).join('\n');
 for(const event of ['action.started','action.finished','batch.started','batch.finished','batch.interrupted','node.paused','nodes.resume','transaction.unresolved','transactions.unresolved','request.error'])assert.ok(server.includes(`logEvent('${event}'`),event);
 for(const event of ['settings.saved','preview-settings.saved','radarr-settings.saved','quarantine.restored'])assert.ok(routes.includes(`logEvent('${event}'`),event);
 assert.doesNotMatch(routes,/logEvent\('radarr-settings\.saved',\{[^}]*apiKey/,'the Radarr key is never passed to the log');
});
