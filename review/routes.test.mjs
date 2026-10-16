import test from 'node:test';
import assert from 'node:assert/strict';
import {serverHarness,linuxServer} from './test-helpers/server.mjs';
import {libraryRoutes} from './routes/library.mjs';
import {itemRoutes} from './routes/items.mjs';
import {previewRoutes} from './routes/previews.mjs';
import {settingsRoutes} from './routes/settings.mjs';
import {staticRoutes} from './routes/static.mjs';
import {nodeRoutes} from './routes/nodes.mjs';

const modules={libraryRoutes,itemRoutes,previewRoutes,settingsRoutes,nodeRoutes,staticRoutes};
const ID='a'.repeat(24);
// Every authenticated route served before the split of server.mjs (#12).
const ROUTES=[
 ['GET','/api/artwork/review/'+ID,'libraryRoutes'],['GET','/api/artwork/request/'+ID,'libraryRoutes'],
 ['GET','/api/statistics','libraryRoutes'],['GET','/api/quarantine','libraryRoutes'],
 ['GET','/api/radarr/settings','libraryRoutes'],['POST','/api/radarr/settings','libraryRoutes'],['POST','/api/radarr/settings/test','libraryRoutes'],
 ['GET','/api/radarr/requests','libraryRoutes'],['POST','/api/radarr/requests/'+ID+'/restore','libraryRoutes'],
 ['GET','/api/recovery/runtime','libraryRoutes'],
 ['GET','/api/items','itemRoutes'],['POST','/api/items/'+ID+'/replace','itemRoutes'],
 ['GET','/api/items/'+ID+'/review-session','itemRoutes'],['POST','/api/items/'+ID+'/review-session','itemRoutes'],
 ['POST','/api/approve-batch','itemRoutes'],['POST','/api/items/'+ID+'/recheck','itemRoutes'],
 ['POST','/api/items/'+ID+'/approve','itemRoutes'],['POST','/api/items/'+ID+'/reject','itemRoutes'],['GET','/api/items/'+ID+'/video','itemRoutes'],
 ['GET','/api/preview-settings','previewRoutes'],['POST','/api/preview-settings','previewRoutes'],['GET','/api/items/'+ID+'/preview-status','previewRoutes'],
 ['POST','/api/items/'+ID+'/audio-compare','previewRoutes'],['POST','/api/items/'+ID+'/frames','previewRoutes'],
 ['GET','/api/settings','settingsRoutes'],['POST','/api/settings','settingsRoutes'],['POST','/api/settings/test','settingsRoutes'],['POST','/api/node-restores/keep','nodeRoutes'],
 ...['/','/app.js','/ui-kit.js','/recovery-view.js','/comparison.js','/settings-dialogs.js','/quarantine.js','/statistics.js','/error-messages.js','/review-workflow.js','/av-player.js','/review-model.js','/i18n.js','/messages.en.js','/style.css','/favicon.svg'].map(p=>['GET',p,'staticRoutes']),
];
const TOUCHED=Symbol('ctx touched');
// A server context that records any use, so a module that does not own a route
// is shown to leave the shared state alone.
const strictCtx=()=>new Proxy({},{get(_target,key){if(key==='then')return undefined;throw TOUCHED},set(){throw TOUCHED}});
const fakeReq=(method,url)=>({method,url,headers:{},socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){yield '{}'}});
const fakeRes=()=>({headersSent:false,writeHead(){this.headersSent=true;return this},end(){},on(){}});
async function claims(route,method,pathname){
 try{return await route(strictCtx(),fakeReq(method,pathname),fakeRes(),new URL(pathname,'http://review.test'),{mutation:null})===true}
 catch(error){if(error===TOUCHED)return true;throw error}
}

test('every route that server.mjs served is claimed by exactly one route module',async()=>{
 for(const [method,pathname,owner] of ROUTES){
  const claimed=[];
  for(const [name,route] of Object.entries(modules))if(await claims(route,method,pathname))claimed.push(name);
  assert.deepEqual(claimed,[owner],method+' '+pathname);
 }
});

test('unknown paths and wrong methods fall through without touching server state',async()=>{
 for(const [method,pathname] of [['GET','/nope'],['POST','/'],['DELETE','/api/items'],['GET','/api/items/'+ID+'/approve'],['GET','/api/login'],['GET','/public/app.js']])
  for(const [name,route] of Object.entries(modules))assert.equal(await claims(route,method,pathname),false,name+' '+method+' '+pathname);
});

test('HTTP guards precede dispatch for claimed and unknown paths; login remains reachable',linuxServer,async t=>{
 const f=await serverHarness();t.after(()=>f.close());await f.start({traceRoutes:true});
 for(const route of ['/api/settings','/api/preview-settings','/api/not-a-route']){
  assert.equal((await f.request(route,{headers:{host:'wrong.invalid'}})).status,403,route+' host');
  assert.equal((await f.request(route)).status,401,route+' authentication');
  assert.equal((await f.request(route,{method:'POST',headers:{origin:'http://wrong.invalid'},body:{}})).status,403,route+' origin');
  assert.equal((await f.request(route,{method:'POST',body:{}})).status,401,route+' mutation authentication');
 }
 assert.deepEqual(await f.routeCalls(),[],'refused requests never dispatch to route modules');
 const cookie=await f.login();
 assert.deepEqual(await f.routeCalls(),[],'login is handled before authenticated routes');
 assert.equal((await f.request('/api/settings',{headers:{cookie}})).status,200);
 assert.equal((await f.request('/api/not-a-route',{headers:{cookie}})).status,404);
 assert.equal((await f.request('/api/login',{method:'POST',headers:{origin:'http://wrong.invalid'},body:{}})).status,403);
 assert.equal((await f.request('/app.js',{headers:{host:'wrong.invalid'}})).status,403);
});

test('HTTP mutation gate refuses a claimed route before dispatch and releases later requests',linuxServer,async t=>{
 const f=await serverHarness();t.after(()=>f.close());
 await f.start({traceRoutes:true,state:{items:{},history:[],sessions:{},pauses:[{name:'synthetic-node'}]}});
 const cookie=await f.login();
 const blocked=await f.request('/api/settings',{method:'POST',headers:{cookie},body:{}});
 assert.equal(blocked.status,409);
 assert.deepEqual(await f.routeCalls(),[],'blocked mutation never dispatches');
 assert.equal((await f.request('/api/settings',{headers:{cookie}})).status,200,'read remains available');
});
