import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {defaults} from '../config.mjs';

export const linuxServer={skip:process.platform!=='linux'?'Requires Linux directory fsync':false,timeout:60000};
export async function deadline(promise,label){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timed out: '+label)),20000)})])}finally{clearTimeout(timer)}
}

// Own only synthetic directories and a loopback port. Callers can prepare media,
// databases and loopback API mocks before start(), and always register close().
// On Linux the harness binds its loopback port once with SO_REUSEPORT and hands the listening socket
// to each server it starts (listen-preload.cjs), so the port is never free between reservation and
// start, also across restarts (#191). Elsewhere the port is reserved and released as before.
const HANDOFF=process.platform==='linux',LISTEN_FD=4;
async function bindLoopback(port=0,host='127.0.0.1'){
 const socket=net.createServer(connection=>connection.destroy());
 await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen({port,host,...(HANDOFF?{reusePort:true}:{})},()=>{socket.off('error',reject);resolve()})});
 return socket;
}
// `host: '0.0.0.0'` is only for tests that must reach the server from a non-loopback address.
export async function serverHarness({host='127.0.0.1'}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-server-'));
 const data=path.join(root,'data'),media=path.join(root,'media'),review=path.join(root,'review');
 let child,diagnostics='',output='',reservation=null;
 const release=async()=>{const socket=reservation;reservation=null;if(socket)await new Promise(resolve=>socket.close(resolve))};
 try{
  for(const dir of [data,media,review,path.join(data,'transactions')])await fs.mkdir(dir,{recursive:true});
  reservation=await bindLoopback(0,host);
  const port=reservation.address().port,base='http://127.0.0.1:'+port;
  if(!HANDOFF)await release();
  const request=async(route,{method='GET',headers={},body}={})=>{
   const options={method,headers:{...(method==='POST'?{origin:base,'content-type':'application/json'}:{}),...headers}};
   // node:http preserves deliberate Host headers (fetch can replace them).
   return new Promise((resolve,reject)=>{
    const req=http.request(base+route,options,res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})))});
    req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
   });
  };
  const stopProcess=async()=>{
    if(child&&child.exitCode===null&&child.signalCode===null){
     // Join the running server's port before it exits, so a restart finds the port still held.
     if(HANDOFF&&!reservation)reservation=await bindLoopback(port,host);
     const closed=new Promise(resolve=>child.once('close',resolve));child.kill('SIGTERM');
     try{await deadline(closed,'server shutdown')}catch(error){child.kill('SIGKILL');await closed;throw error}
    }
  };
  const killProcess=async()=>{
   if(child&&child.exitCode===null&&child.signalCode===null){
    if(HANDOFF&&!reservation)reservation=await bindLoopback(port,host);
    const closed=new Promise(resolve=>child.once('close',resolve));child.kill('SIGKILL');await closed;
   }
  };
  const close=async()=>{
   try{await stopProcess();}finally{await release();await fs.rm(root,{recursive:true,force:true})}
  };
  return {root,data,media,review,port,base,request,close,stop:stopProcess,kill:killProcess,diagnostics:()=>diagnostics,output:()=>output,
   async start({settings={},state,preload,clock=false,traceRoutes=false,env={},supervisor=false}={}){
    try{
     // Every default endpoint is loopback; missing synthetic databases fail closed.
     const config={...defaults({MEDIA_ROOT:media,REVIEW_ROOT:review,TDARR_DB:path.join(root,'missing.db'),TDARR_URL:base,PUBLIC_ORIGIN:base}),...settings};
     await fs.writeFile(path.join(data,'settings.json'),JSON.stringify(config));
     await fs.writeFile(path.join(data,'preview-settings.json'),JSON.stringify({enabled:false}));
     if(state)await fs.writeFile(path.join(data,'state.json'),JSON.stringify(state));
     const args=[];
     if(HANDOFF)args.push('--require',fileURLToPath(new URL('./listen-preload.cjs',import.meta.url)));
     if(preload)args.push('--require',preload);
     const trace=path.join(root,'route-calls.jsonl');
     if(traceRoutes)await fs.writeFile(trace,'');
     if(clock||traceRoutes)args.push('--require',fileURLToPath(new URL('./server-preload.cjs',import.meta.url)));
     if(supervisor){
      const launcher=path.join(root,'supervised.mjs');
      await fs.writeFile(launcher,`import {supervise} from ${JSON.stringify(new URL('../supervisor.mjs',import.meta.url).href)};process.exit(await supervise({mode:process.env.RECOVERY_MODE,dataRoot:process.env.DATA_ROOT,review:[process.execPath,...${JSON.stringify(args)},${JSON.stringify(fileURLToPath(new URL('../server.mjs',import.meta.url)))}],recovery:[process.execPath,${JSON.stringify(fileURLToPath(new URL('../../recovery/worker.mjs',import.meta.url)))}],lowPriority:[]}));`);
      args.length=0;if(HANDOFF)args.push('--require',fileURLToPath(new URL('./listen-preload.cjs',import.meta.url)));args.push(launcher);
     }else args.push(fileURLToPath(new URL('../server.mjs',import.meta.url)));
     const stdio=['ignore','pipe','pipe',clock?'ipc':'ignore'];
     if(HANDOFF){if(!reservation)reservation=await bindLoopback(port,host);stdio[LISTEN_FD]=reservation._handle.fd;}
     child=spawn(process.execPath,args,{env:{...process.env,...env,DATA_ROOT:data,PORT:String(port),REVIEW_TEST_CLOCK:clock?'1':'0',REVIEW_TEST_TRACE:traceRoutes?trace:'',...(HANDOFF?{REVIEW_TEST_LISTEN_FD:String(LISTEN_FD)}:{})},stdio});
     // The child holds its own copy of the listening socket; this process stops accepting on it.
     await release();
     await deadline(new Promise((resolve,reject)=>{
      child.stdout.on('data',chunk=>{output+=chunk;if(String(chunk).includes('Tdarr Review listening'))resolve()});
      child.stderr.on('data',chunk=>{diagnostics+=chunk});child.once('error',reject);child.once('exit',code=>reject(Error('Server exited '+code+': '+diagnostics)));
     }),'server startup');
    }catch(error){await close();throw error}
   },
   async login(){
    const key=await fs.readFile(path.join(data,'access-key'),'utf8');
    const response=await request('/api/login',{method:'POST',body:{key}});
    assert.equal(response.status,200,await response.clone().text());return response.headers.get('set-cookie').split(';')[0];
   },
   async tick({advance=0,interval}={}){
    const id=crypto.randomUUID();
    await deadline(new Promise(resolve=>{const listener=message=>{if(message.ack===id){child.off('message',listener);resolve()}};child.on('message',listener);child.send({id,advance,interval})}),'test clock');
   },
   async routeCalls(){const raw=await fs.readFile(path.join(root,'route-calls.jsonl'),'utf8');return raw.trim()?raw.trim().split('\n').map(line=>JSON.parse(line)):[]},
   async state(){return JSON.parse(await fs.readFile(path.join(data,'state.json'),'utf8'))}
  };
 }catch(error){await release();await fs.rm(root,{recursive:true,force:true});throw error}
}
