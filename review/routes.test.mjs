import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {libraryRoutes} from './routes/library.mjs';
import {itemRoutes} from './routes/items.mjs';
import {previewRoutes} from './routes/previews.mjs';
import {settingsRoutes} from './routes/settings.mjs';
import {staticRoutes} from './routes/static.mjs';

const modules={libraryRoutes,itemRoutes,previewRoutes,settingsRoutes,staticRoutes};
const ID='a'.repeat(24);
// Every authenticated route served before the split of server.mjs (#12).
const ROUTES=[
 ['GET','/api/artwork/review/'+ID,'libraryRoutes'],['GET','/api/artwork/request/'+ID,'libraryRoutes'],
 ['GET','/api/statistics','libraryRoutes'],['GET','/api/quarantine','libraryRoutes'],
 ['GET','/api/radarr/settings','libraryRoutes'],['POST','/api/radarr/settings','libraryRoutes'],['POST','/api/radarr/settings/test','libraryRoutes'],
 ['GET','/api/radarr/requests','libraryRoutes'],['POST','/api/radarr/requests/'+ID+'/restore','libraryRoutes'],
 ['GET','/api/items','itemRoutes'],['POST','/api/items/'+ID+'/replace','itemRoutes'],
 ['GET','/api/items/'+ID+'/review-session','itemRoutes'],['POST','/api/items/'+ID+'/review-session','itemRoutes'],
 ['POST','/api/approve-batch','itemRoutes'],['POST','/api/items/'+ID+'/recheck','itemRoutes'],
 ['POST','/api/items/'+ID+'/approve','itemRoutes'],['POST','/api/items/'+ID+'/reject','itemRoutes'],['GET','/api/items/'+ID+'/video','itemRoutes'],
 ['GET','/api/preview-settings','previewRoutes'],['POST','/api/preview-settings','previewRoutes'],['GET','/api/items/'+ID+'/preview-status','previewRoutes'],
 ['POST','/api/items/'+ID+'/audio-compare','previewRoutes'],['POST','/api/items/'+ID+'/frames','previewRoutes'],
 ['GET','/api/settings','settingsRoutes'],['POST','/api/settings','settingsRoutes'],['POST','/api/settings/test','settingsRoutes'],
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

test('server.mjs keeps host, origin, login, authentication and mutation claims ahead of route dispatch',async()=>{
 const server=await fs.readFile(new URL('./server.mjs',import.meta.url),'utf8');
 const order=["if(req.headers.host!==HOST)","req.headers.origin!==config.publicOrigin","if(await login(ctx,req,res,url))return;","!authenticated(ctx,req))return respond(res,401","const kind=mutationKind(","await previews.pauseBackground({wait:true})","for(const route of routes)if(await route(ctx,req,res,url,request))return;\n    respond(res,404,"].map(text=>server.indexOf(text));
 assert.ok(order.every(index=>index>0),JSON.stringify(order));
 assert.deepEqual([...order].sort((a,b)=>a-b),order);
 assert.match(server,/finally\{if\(request\.mutation&&mutationOwner===request\.mutation\)mutationOwner=null;/);
});
