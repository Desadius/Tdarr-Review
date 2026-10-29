import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import {emptyTvLibrary} from './library-paths.mjs';

const apiKey='synthetic-reconcile-http-secret';
const digest=value=>createHash('sha256').update(value).digest('hex');
const settle=async(fixture,id)=>{
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){const state=await fixture.get('/api/shared-settings/status');if(state.id===id&&['succeeded','failed','cancelled'].includes(state.state)){assert.equal(state.state,'succeeded',JSON.stringify(state));return state;}await new Promise(resolve=>setTimeout(resolve,20));}
 assert.fail('Timed out applying the synthetic TV settings.');
};
async function signature(root){
 const rows=[];async function walk(folder,relative=''){
  for(const entry of await fs.readdir(folder,{withFileTypes:true})){const name=relative?relative+'/'+entry.name:entry.name,file=path.join(folder,entry.name),stat=await fs.lstat(file);rows.push([name,stat.mode,stat.size,stat.mtimeMs,stat.ino,stat.nlink]);if(stat.isDirectory()&&!stat.isSymbolicLink())await walk(file,name);}
 }
 await walk(root);return createHash('sha256').update(JSON.stringify(rows.sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex');
}

test('authenticated selected-series reconciliation is read-only, rejects caller paths, and gates unapplied settings',async t=>{
 const calls=[],seriesPath='/sonarr/tv/Synthetic Series 291',sonarr=http.createServer((req,res)=>{
  calls.push({method:req.method,path:req.url,key:req.headers['x-api-key']});const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  const value=pathname.endsWith('/system/status')?{version:'synthetic'}:pathname.endsWith('/series')?[{id:291,title:'Synthetic Series 291',path:seriesPath,seriesType:'daily',arbitraryPrivateField:'must not echo'}]:pathname.endsWith('/episodefile')?[{id:29101,seriesId:291,path:seriesPath+'/S01E01.mkv',relativePath:'S01E01.mkv'}]:pathname.endsWith('/episode')?[{id:291001,seriesId:291,episodeFileId:29101,hasFile:true,seasonNumber:1,episodeNumber:1,airDateUtc:'2022-01-02T00:00:00Z'}]:{};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));
 });
 await new Promise(resolve=>sonarr.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>sonarr.close(resolve)));
 const fixture=await reviewFixture({beforeStart:async({root})=>{
  const mediaRoot=path.join(root,'tv-media'),selected=path.join(mediaRoot,'Synthetic Series 291'),other=path.join(mediaRoot,'Other Series Sentinel');
  await fs.mkdir(selected,{recursive:true});await fs.mkdir(other,{recursive:true});await fs.writeFile(path.join(selected,'S01E01.mkv'),'synthetic marker');await fs.writeFile(path.join(selected,'local-only.mkv'),'synthetic local');await fs.writeFile(path.join(other,'outside.mkv'),'outside sentinel');
 }});t.after(()=>fixture.close());
 const initial=await fixture.get('/api/shared-settings'),tv={...emptyTvLibrary(),sonarrRoot:'/sonarr/tv',mediaRoot:path.join(fixture.root,'tv-media')};
 const saved=await fixture.post('/api/shared-settings/draft',{revision:initial.revision,patch:{sonarr:{url:'http://127.0.0.1:'+sonarr.address().port+'/sonarr',apiKey},libraries:{tv}}});assert.equal(saved.status,200,await saved.clone().text());
 let {revision}=await saved.json();const checked=await fixture.post('/api/shared-settings/test',{revision});assert.equal(checked.status,200,await checked.clone().text());
 const applying=await fixture.post('/api/shared-settings/apply',{revision,invalidation:{level:'all',reviews:0,approvals:0}});assert.equal(applying.status,202,await applying.clone().text());await settle(fixture,(await applying.json()).id);
 revision=(await fixture.get('/api/shared-settings')).revision;calls.length=0;
 const root=tv.mediaRoot,before=await signature(root),secretState=await fs.readFile(path.join(fixture.data,'shared-settings.json')),database=path.join(fixture.root,'tdarr','DB','tdarr.db'),databaseBefore=digest(await fs.readFile(database));
 const route='/api/sonarr/reconcile?revision='+revision+'&seriesId=291';
 assert.equal((await fixture.request(route,{headers:{cookie:''}})).status,401);
 for(const invalid of [route+'&mediaRoot=%2Fetc',route+'&path=%2Fetc%2Fpasswd',route+'&seriesId=291'])assert.equal((await fixture.request(invalid)).status,400,invalid);
 const response=await fixture.request(route);assert.equal(response.status,200,await response.clone().text());const result=await response.json();
 assert.equal(result.complete,true);assert.equal(result.rows.find(row=>row.episodeFileId===29101).status,'present');assert.equal(result.rows.find(row=>row.relative==='local-only.mkv').status,'local_only');
 const json=JSON.stringify(result);for(const privateValue of [apiKey,fixture.root,root,seriesPath,'arbitraryPrivateField'])assert.equal(json.includes(privateValue),false,privateValue);
 const repeated=await fixture.request(route);assert.equal(repeated.status,200);const secondResult=await repeated.json();assert.deepEqual({...secondResult,observedAt:result.observedAt},result);assert.ok(secondResult.observedAt>=result.observedAt);
 assert.equal(calls.length,12);assert.ok(calls.every(call=>call.method==='GET'&&call.key===apiKey));assert.equal(await signature(root),before);assert.deepEqual(await fs.readFile(path.join(fixture.data,'shared-settings.json')),secretState);assert.equal(digest(await fs.readFile(database)),databaseBefore);
 calls.length=0;
 const current=await fixture.get('/api/shared-settings'),mismatched=await fixture.post('/api/shared-settings/draft',{revision:current.revision,patch:{sonarr:{url:'http://127.0.0.1:'+sonarr.address().port+'/different'}}});assert.equal(mismatched.status,200,await mismatched.clone().text());const newRevision=(await mismatched.json()).revision;
 const stale=await fixture.request(route);assert.equal(stale.status,409);assert.equal(calls.length,0);
 const mismatch=await fixture.request('/api/sonarr/reconcile?revision='+newRevision+'&seriesId=291');assert.equal(mismatch.status,200);const notApplied=await mismatch.json();assert.equal(notApplied.complete,false);assert.equal(notApplied.reason,'settings_not_applied');assert.equal(notApplied.rows.length,0);assert.equal(calls.length,0);assert.equal(await signature(root),before);
});
