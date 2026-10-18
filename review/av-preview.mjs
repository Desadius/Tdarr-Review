import {validateRecoveredPreview,validateAlignedStart} from './preview-validation.mjs';
import {withMpeg2Initialization} from './mpeg2-initialization.mjs';
import {previewErrors} from './preview-diagnostics.mjs';
import {spawnPreview} from './preview-process.mjs';
export const CLIP_SECONDS=12;
// Per-attempt ceiling and the shared deadline of one original/Review AV pair, validation included (#183).
export const ATTEMPT_MS=90000,PAIR_MS=180000;
const PAIR_TIMEOUT='Příprava náhledu překročila společný časový limit 180 sekund pro originál a výsledek.';
export const PREVIEW_PROFILES=Object.freeze({compact:Object.freeze({width:960,height:540,crf:24}),detail:Object.freeze({width:1920,height:1080,crf:16})});
export function previewProfile(name='compact'){
 if(!Object.hasOwn(PREVIEW_PROFILES,name))throw Error('Neplatný profil videonáhledu.');
 return PREVIEW_PROFILES[name];
}
export function previewArgs(file,index,seconds,startTime,video,profileName='compact',preroll=2){
 const profile=previewProfile(profileName);
 if(!Number.isInteger(index)||index<0||!Number.isFinite(seconds)||seconds<0||!Number.isFinite(startTime)||!video||!Number.isInteger(video.index)||video.index<0||!Number.isFinite(preroll)||preroll<0||preroll>60)throw Error('Neplatné parametry náhledu.');
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
  return /^(?:top block unavailable for requested intra mode(?:\s+-?\d+)?|Reference\s+\d+\s*>=\s*\d+|error while decoding MB\s+\d+\s+\d+(?:,\s*bytestream\s+-?\d+)?|mmco: unref short failure)\s*$/i.test(match[1]);
 });
}
// After some input seeks the selected audio stream first decodes in another sample format (s32p,
// then s16p); FFmpeg 7.1 cannot reinitialize the filter graph and stops (#183). Only that exact
// cascade, starting at the selected stream, qualifies: any other line, exit code or stream does not.
const CASCADE=[
 /^\[fc#0 @ (?:0x)?[0-9a-f]+\] (?:Error reinitializing filters!|Task finished with error code: -22 \(Invalid argument\)|Terminating thread with return code -22 \(Invalid argument\))$/,
 /^\[(?:vost#0:0\/libx264|aost#0:1\/aac) @ (?:0x)?[0-9a-f]+\] (?:Could not open encoder before EOF|Task finished with error code: -22 \(Invalid argument\)|Terminating thread with return code -22 \(Invalid argument\))$/,
 /^\[out#0\/mp4 @ (?:0x)?[0-9a-f]+\] Nothing was written into output file, because at least one of its streams received no packets\.$/,
];
export function canRetryAudioInitialization(error,{index,signal}={}){
 if(signal?.aborted||!Number.isInteger(index)||error?.previewExitCode!==234)return false;
 const lines=previewErrors(error?.previewDiagnostics||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 const trigger=new RegExp('^\\[graph_0_in_0:'+index+' @ (?:0x)?[0-9a-f]+\\] Changing audio frame properties on the fly is not supported\\.$');
 return trigger.test(lines[0]||'')&&lines.includes(lines.find(line=>/\] Error reinitializing filters!$/.test(line)))&&lines.slice(1).every(line=>CASCADE.some(pattern=>pattern.test(line)));
}
// Earlier input seeks for that failure: at most two more attempts, never past the pair deadline.
export const AUDIO_PREROLLS=Object.freeze([30,60]);
const exhausted=(message,cause)=>Object.assign(Error(message),{previewDiagnostics:cause?.previewDiagnostics,previewExitCode:cause?.previewExitCode,previewFallback:'external'});
export async function withPreviewSeekRetry(run,context){
 context.signal?.throwIfAborted();
 try{return await run(2)}catch(error){
  if(canRetryPreviewSeek(error,context)){context.signal?.throwIfAborted();return run(30);}
  if(!canRetryAudioInitialization(error,context))throw error;
  let last=error,previous=2;
  for(const preroll of AUDIO_PREROLLS){
   if(Math.max(0,context.seconds-preroll)>=Math.max(0,context.seconds-previous))break;previous=preroll;
   context.signal?.throwIfAborted();
   const late=()=>exhausted('Zvuk vybrané stopy nešlo po přetočení připravit v časovém limitu 180 sekund.',last);
   if(Number.isFinite(context.deadline)&&Date.now()>=context.deadline)throw late();
   let data;try{data=await run(preroll)}catch(retry){if(retry?.previewPairDeadline)throw late();if(!canRetryAudioInitialization(retry,context))throw retry;last=retry;continue}
   return context.recovered?await context.recovered(data):data;
  }
  throw exhausted('Zvuk vybrané stopy nešlo po přetočení připravit ani s dřívějším začátkem dekódování (30 a 60 s).',last);
 }
}
function extractPreviewOnce(exe,args,options){
 return new Promise((resolve,reject)=>{
  const child=spawnPreview(exe,args,options);let size=0,stderr='',failure;const chunks=[];
  const stop=(message,extra)=>{failure=Object.assign(Error(message),extra);child.kill('SIGKILL')};
  const timer=setTimeout(()=>options.pairLimited?stop(PAIR_TIMEOUT,{previewPairDeadline:true}):stop('Příprava náhledu překročila 90 sekund.'),options.timeoutMs??90000);
  child.stdout.on('data',b=>{size+=b.length;if(size>20*1024*1024)stop('Náhled překročil limit velikosti. Zvol rychlý profil nebo porovnej původní snímky v rozlišení 1 : 1.');else chunks.push(b)});
  child.stderr.on('data',b=>{stderr=(stderr+b).slice(-16384)});
  child.on('error',e=>{failure=e;});
  child.on('close',code=>{clearTimeout(timer);const data=Buffer.concat(chunks);if(failure)return reject(failure);if(code||previewErrors(stderr).trim()||data.length<32||data.toString('ascii',4,8)!=='ftyp'){const error=Error('Nelze připravit náhled: '+stderr);error.previewDiagnostics=stderr;error.previewExitCode=code;return reject(error)}resolve(data.toString('base64'))});
 });
}
// options.deadline is the shared deadline of the original/Review pair; every subprocess gets at
// most ATTEMPT_MS of what remains of it. Without one, a single call keeps its own ATTEMPT_MS budget.
export function extractPreview(exe,file,index,seconds,startTime,video,profileName='compact',options={}){
 const pairDeadline=Number.isFinite(options.deadline)?options.deadline:Date.now()+ATTEMPT_MS,frameRate=Number(String(video.avg_frame_rate).split('/')[0])/Number(String(video.avg_frame_rate).split('/')[1]);
 const {deadline:_unused,...spawnOptions}=options;
 const left=()=>{const ms=pairDeadline-Date.now();if(ms<=0)throw Object.assign(Error(PAIR_TIMEOUT),{previewPairDeadline:true});return ms};
 return withMpeg2Initialization(file,async input=>{
  // Output after an earlier seek for the audio failure must decode completely and start aligned.
  const recovered=async data=>{await validateRecoveredPreview(exe,data,{...spawnOptions,deadline:pairDeadline,frameRate});await validateAlignedStart(exe,data,{...spawnOptions,deadline:pairDeadline});return data};
  const result=await withPreviewSeekRetry(preroll=>extractPreviewOnce(exe,previewArgs(input,index,seconds,startTime,video,profileName,preroll),{...spawnOptions,timeoutMs:Math.min(ATTEMPT_MS,left()),pairLimited:Number.isFinite(options.deadline)&&left()<ATTEMPT_MS}),{seconds,video,index,signal:options.signal,deadline:pairDeadline,recovered});
  return input===file?result:validateRecoveredPreview(exe,result,{...spawnOptions,deadline:pairDeadline,frameRate});
 },{signal:options.signal,budgetMs:Math.max(1,pairDeadline-Date.now())});
}
