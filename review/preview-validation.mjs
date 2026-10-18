import {spawnPreview} from './preview-process.mjs';
import {previewErrors} from './preview-diagnostics.mjs';
// Recovery candidates must decode as a complete video and a complete audio stream.
// Each child is drained before the next starts, within the original request deadline.
async function decode(exe,data,args,{signal,background,deadline},limit){
 signal?.throwIfAborted();if(Date.now()>=deadline)throw Error('Příprava náhledu překročila 90 sekund.');
 return new Promise((resolve,reject)=>{
  const child=spawnPreview(exe,['-v','error','-nostdin','-threads','2','-i','pipe:0',...args],{signal,background,input:true});
  const chunks=[];let bytes=0,stderr='',failure;
  const timer=setTimeout(()=>{failure=Error('Příprava náhledu překročila 90 sekund.');child.kill('SIGKILL');},Math.max(1,deadline-Date.now()));
  child.stdout.on('data',b=>{bytes+=b.length;if(bytes>limit){failure=Error('Neúplný náhled.');child.kill('SIGKILL');}else chunks.push(b);});
  child.stderr.on('data',b=>{stderr=(stderr+b).slice(-16384);});
  child.on('error',e=>{failure=e;});child.stdin.on('error',()=>{});child.stdin.end(data);
  child.on('close',code=>{clearTimeout(timer);if(failure)return reject(failure);if(code||previewErrors(stderr).trim())return reject(Error('Neúplný náhled.'));resolve(Buffer.concat(chunks));});
 });
}
export async function validateRecoveredPreview(exe,base64,options){
 const data=Buffer.from(base64,'base64');
 const progress=(await decode(exe,data,['-map','0:v:0','-an','-progress','pipe:1','-f','null','-'],options,65536)).toString();
 const value=key=>Number([...progress.matchAll(new RegExp('^'+key+'=(\\d+)$','gm'))].at(-1)?.[1]);
 if(!Number.isFinite(options.frameRate)||options.frameRate<=0)throw Error('Neúplný náhled.');
 const minimum=Math.max(1,Math.floor(options.frameRate*12*.95));
 if(!(value('frame')>=minimum)||!(value('out_time_us')>=11400000&&value('out_time_us')<=12200000))throw Error('Neúplný náhled.');
 const audio=await decode(exe,data,['-map','0:a:0','-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],options,48000*4*12.2);
 if(audio.length<48000*4*11.4||audio.length%4)throw Error('Neúplný zvukový úsek.');
 for(let p=0;p<audio.length;p+=4)if(!Number.isFinite(audio.readFloatLE(p)))throw Error('Neplatné zvukové vzorky.');
 return base64;
}
