import path from 'node:path';
import {spawn} from 'node:child_process';

// Metadata is only for a progress estimate. Failure is not source damage.
export async function probeDuration({ffmpeg,ffprobe,file,timeoutMs=10000,spawnChild=spawn}){
 const exe=ffprobe||path.join(path.dirname(ffmpeg),'ffprobe');
 return new Promise(resolve=>{
  let output='',done=false,child;
  const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};
  const timer=setTimeout(()=>{child?.kill('SIGKILL');finish(null)},timeoutMs);
  try{child=spawnChild(exe,['-v','error','-show_entries','format=duration','-of','json',file],{stdio:['ignore','pipe','ignore']});}catch{finish(null);return;}
  child.stdout.on('data',b=>{output+=b.toString();if(output.length>65536){child.kill('SIGKILL');finish(null);}});
  child.on('error',()=>finish(null));
  child.on('close',code=>{let value=null;try{const raw=JSON.parse(output).format?.duration;if(typeof raw==='number'||typeof raw==='string'&&raw.trim())value=Number(raw);}catch{}finish(code===0&&Number.isFinite(value)&&value>0?value:null);});
 });
}

export async function runOriginalDecode({ffmpeg,file,headerDamage=false,timeoutMs,onProgressData=()=>{},spawnChild=spawn}){
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('Invalid original decode timeout');
 const args=['-hide_banner','-nostdin','-v','error','-xerror','-err_detect','explode','-progress','pipe:1','-nostats','-stats_period','2','-threads','2',...(headerDamage?['-f','matroska']:[]),'-i',file,'-map','0:v:0','-map','0:a?','-threads','2','-f','null','-'];
 return new Promise(resolve=>{
  let stderr='',error=null,timeout=false,child,done=false,decodedFrames=0,progress='',diagnosticsTruncated=false;
  const finish=(code,signal)=>{if(done)return;done=true;clearTimeout(timer);resolve({code,signal,error,timeout,stderr,decodedFrames,diagnosticsTruncated});};
  const timer=setTimeout(()=>{timeout=true;child?.kill('SIGKILL');},timeoutMs);
  try{child=spawnChild(ffmpeg,args,{stdio:['ignore','pipe','pipe']});}catch(e){error=e.code||'spawn failure';finish(null,null);return;}
  child.stdout.on('data',b=>{onProgressData(b);progress+=b.toString();const lines=progress.split(/\r?\n/);progress=lines.pop().slice(-4096);for(const line of lines){const m=/^frame=\s*(\d+)\s*$/.exec(line);if(m&&Number.isSafeInteger(Number(m[1])))decodedFrames=Math.max(decodedFrames,Number(m[1]));}});
  child.stderr.on('data',b=>{const text=stderr+b.toString();if(text.length>131072)diagnosticsTruncated=true;stderr=text.slice(-131072)});
  child.on('error',e=>{error=e.code||'spawn failure';finish(null,null)});
  child.on('close',finish);
 });
}
