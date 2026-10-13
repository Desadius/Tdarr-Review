import {previewErrors} from './preview-diagnostics.mjs';
import {spawnPreview} from './preview-process.mjs';
export const CLIP_SECONDS=12;
export const PREVIEW_PROFILES=Object.freeze({compact:Object.freeze({width:960,height:540,crf:24}),detail:Object.freeze({width:1920,height:1080,crf:16})});
export function previewProfile(name='compact'){
 if(!Object.hasOwn(PREVIEW_PROFILES,name))throw Error('Neplatný profil videonáhledu.');
 return PREVIEW_PROFILES[name];
}
export function previewArgs(file,index,seconds,startTime,video,profileName='compact',preroll=2){
 const profile=previewProfile(profileName);
 if(!Number.isInteger(index)||index<0||!Number.isFinite(seconds)||seconds<0||!Number.isFinite(startTime)||!video||!Number.isInteger(video.index)||video.index<0||!Number.isFinite(preroll)||preroll<0||preroll>30)throw Error('Neplatné parametry náhledu.');
 const transfer=video.color_transfer;
 if(!['bt709','smpte170m','smpte2084',undefined,'unknown'].includes(transfer))throw Error('Tento barevný profil zatím nelze bezpečně zobrazit v náhledu.');
 const start=seconds+startTime,end=start+CLIP_SECONDS;
 const tone=transfer==='smpte2084'?'zscale=pin=bt2020:tin=smpte2084:min=bt2020nc:rin=limited:t=linear:p=bt2020:m=gbr:r=full:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:peak=10:desat=0,zscale=t=bt709:m=bt709:r=limited,':'';
 // Both streams subtract the same container origin: never STARTPTS each independently.
 // Fit display dimensions, including non-square source pixels, without stretching either copy.
 const sar='if(gt(sar,0),sar,1)',dar=`(iw*${sar}/ih)`;
 const scale=`scale=w='max(2,trunc(min(iw*${sar},min(${profile.width},${profile.height}*${dar}))/2)*2)':h='max(2,trunc(ow/${dar}/2)*2)':flags=lanczos,setsar=1`;
 const filter=`[0:${video.index}]trim=start=${start}:end=${end},setpts=PTS-(${start})/TB,${tone}${scale},format=yuv420p[v];[0:${index}]atrim=start=${start}:end=${end},asetpts=PTS-(${start})/TB,aresample=48000:async=1:first_pts=0[a]`;
 return ['-v','error','-nostdin','-threads','2','-copyts','-ss',String(Math.max(0,seconds-preroll)),'-i',file,'-filter_complex_threads','1','-filter_complex',filter,'-map','[v]','-map','[a]','-sn','-dn','-c:v','libx264','-preset','veryfast','-crf',String(profile.crf),'-maxrate',profileName==='detail'?'10M':'3M','-bufsize',profileName==='detail'?'10M':'3M','-threads','2','-bf','0','-fps_mode','vfr','-c:a','aac','-ac','1','-b:a','128k','-t',String(CLIP_SECONDS),'-avoid_negative_ts','disabled','-movflags','frag_keyframe+empty_moov+default_base_moof','-f','mp4','pipe:1'];
}
export function canRetryPreviewSeek(error,{seconds,video,signal}={}){
 if(signal?.aborted||video?.codec_name!=='h264'||!Number.isFinite(seconds)||Math.max(0,seconds-30)>=Math.max(0,seconds-2)||!Number.isInteger(error?.previewExitCode))return false;
 const diagnostics=previewErrors(error?.previewDiagnostics||'').trim();if(!diagnostics)return false;
 return diagnostics.split(/\r?\n/).every(line=>{
  const match=/^\[h264 @ (?:0x)?[0-9a-f]+\]\s*(.*)$/i.exec(line.trim());if(!match)return false;
  return /^(?:top block unavailable for requested intra mode(?:\s+-?\d+)?|Reference\s+\d+\s*>=\s*\d+|error while decoding MB\s+\d+\s+\d+(?:,\s*bytestream\s+-?\d+)?)\s*$/i.test(match[1]);
 });
}
export async function withPreviewSeekRetry(run,context){
 context.signal?.throwIfAborted();
 try{return await run(2)}catch(error){
  if(!canRetryPreviewSeek(error,context))throw error;
  context.signal?.throwIfAborted();return run(30);
 }
}
function extractPreviewOnce(exe,args,options){
 return new Promise((resolve,reject)=>{
  const child=spawnPreview(exe,args,options);let size=0,stderr='',failure;const chunks=[];
  const stop=message=>{failure=Error(message);child.kill('SIGKILL')};
  const timer=setTimeout(()=>stop('Příprava náhledu překročila 90 sekund.'),90000);
  child.stdout.on('data',b=>{size+=b.length;if(size>20*1024*1024)stop('Náhled překročil limit velikosti. Zvol rychlý profil nebo porovnej původní snímky v rozlišení 1 : 1.');else chunks.push(b)});
  child.stderr.on('data',b=>{stderr=(stderr+b).slice(-16384)});
  child.on('error',e=>{clearTimeout(timer);reject(e)});
  child.on('close',code=>{clearTimeout(timer);const data=Buffer.concat(chunks);if(failure)return reject(failure);if(code||previewErrors(stderr).trim()||data.length<32||data.toString('ascii',4,8)!=='ftyp'){const error=Error('Nelze připravit náhled: '+stderr);error.previewDiagnostics=stderr;error.previewExitCode=code;return reject(error)}resolve(data.toString('base64'))});
 });
}
export function extractPreview(exe,file,index,seconds,startTime,video,profileName='compact',options={}){
 return withPreviewSeekRetry(preroll=>extractPreviewOnce(exe,previewArgs(file,index,seconds,startTime,video,profileName,preroll),options),{seconds,video,signal:options.signal});
}
