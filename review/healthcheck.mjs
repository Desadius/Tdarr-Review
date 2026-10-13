import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';

// Probe the local listener while retaining the application's configured Host.
// Saved settings override environment defaults, as they do in server.mjs.
// The loopback-only /health summary is printed into Docker's health log. Conditions
// needing an operator (pending transaction, node restore, stale Recovery status) are
// reported but do not fail the check, so no restart policy interrupts them. The check
// fails only when the server does not answer or the UI itself is not served.
export const UI_PATHS=['/','/app.js'];

// get(path) resolves to {status, text}; any rejection means the server did not answer.
export async function checkHealth(get){
 const health=await get('/health');
 if(health.status!==200)return {ok:false,line:'Health endpoint answered '+health.status};
 for(const route of UI_PATHS){const asset=await get(route);if(asset.status!==200)return {ok:false,line:'UI '+route+' answered '+asset.status}}
 try{const s=JSON.parse(health.text);return {ok:true,line:s.attention?.length?'Attention: '+s.attention.join(', ')+' '+JSON.stringify(s):'OK'}}
 catch{return {ok:true,line:'OK (unreadable summary)'}}
}

function localGet(host,port){
 return route=>new Promise((resolve,reject)=>{
  const request=http.get({host:'127.0.0.1',port,path:route,headers:{Host:host},timeout:4000},response=>{
   let text='';response.setEncoding('utf8');
   response.on('data',chunk=>{if(text.length<65536)text+=chunk});
   response.on('end',()=>resolve({status:response.statusCode,text}));
  });
  request.on('timeout',()=>request.destroy(new Error('Health check timed out')));
  request.on('error',reject);
 });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const file=path.join(process.env.DATA_ROOT||'/data','settings.json');
  const saved=JSON.parse(await fs.readFile(file,'utf8').catch(e=>{
   if(e.code!=='ENOENT')throw e;
   return '{}';
  }));
  const origin=saved.publicOrigin||process.env.PUBLIC_ORIGIN||'http://'+(process.env.PUBLIC_HOST||'localhost:8270');
  const result=await checkHealth(localGet(new URL(origin).host,Number(process.env.PORT||8270)));
  console.log(result.line);process.exit(result.ok?0:1);
 }catch{
  process.exit(1);
 }
}
