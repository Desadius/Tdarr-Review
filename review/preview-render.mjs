import {extractPreview,PREVIEW_PROFILES} from './av-preview.mjs';
import {extractAudio,alignment} from './audio-compare.mjs';
import {extractListeningAudio} from './audio-listen.mjs';
import {extractFrame} from './frames.mjs';

export function createPreviewRenderer({getPair,getConfig}){
 return async(request,{signal,priority='interactive'}={})=>{
  const check=()=>signal?.throwIfAborted();
  check();const pair=await getPair(request,{background:priority==='background'});check();
  const {a,b,pa,pb}=pair,exe=getConfig().ffmpeg;
  const options={signal,background:priority==='background'};
  const duration=Math.min(Number(pa.format?.duration),Number(pb.format?.duration));
  const seconds=request.seconds;
  if(!Number.isFinite(seconds)||seconds<0||!Number.isFinite(duration)||seconds>=duration||request.mode!=='frames'&&seconds+12>duration)throw Error('Čas je mimo délku kontrolovaných souborů.');
  const tracks=p=>(p.streams||[]).filter(s=>s.codec_type==='audio').map(s=>({index:s.index,label:`${s.index}: ${s.tags?.language||'und'} · ${s.codec_name} · ${s.channels} kan. · ${s.tags?.title||''}`}));
  const ta=tracks(pa),tb=tracks(pb),video=p=>(p.streams||[]).find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);
  const va=video(pa),vb=video(pb);
  if(request.mode==='frames'){
   if(!va||!vb)throw Error('Chybí obrazová stopa.');
   const hdr=va.color_transfer==='smpte2084';
   if(hdr!==(vb.color_transfer==='smpte2084')||[va,vb].some(v=>v.color_transfer==='arib-std-b67'))throw Error('Tuto kombinaci HDR nelze porovnat.');
   const original=await extractFrame(exe,a.path,seconds,hdr,options);check();
   const review=await extractFrame(exe,b.path,seconds,hdr,options);check();
   return {seconds,hdr,original:original.toString('base64'),review:review.toString('base64')};
  }
  if(!ta.some(s=>s.index===request.originalIndex)||!tb.some(s=>s.index===request.reviewIndex))throw Error('Vyber platné zvukové stopy.');
  const startA=Number(pa.format?.start_time||0),startB=Number(pb.format?.start_time||0);
  if(request.mode==='listen'){
   const original=await extractListeningAudio(exe,a.path,request.originalIndex,seconds,startA,options);check();
   const review=await extractListeningAudio(exe,b.path,request.reviewIndex,seconds,startB,options);check();
   return {seconds,original,review,originalTrack:ta.find(s=>s.index===request.originalIndex),reviewTrack:tb.find(s=>s.index===request.reviewIndex),processing:'48 kHz PCM; FFmpeg mono downmix; časová osa kontejneru; žádná normalizace hlasitosti ani automatické dorovnání posunu.'};
  }
  let clips;
  if(request.mode==='av'){
   if(!va||!vb||va.color_transfer!==vb.color_transfer)throw Error('Obrazové profily náhledu se neshodují.');
   const profile=PREVIEW_PROFILES[request.profile];if(!profile)throw Error('Neplatný profil videonáhledu.');
   const original=await extractPreview(exe,a.path,request.originalIndex,seconds,startA,va,request.profile,options);check();
   const review=await extractPreview(exe,b.path,request.reviewIndex,seconds,startB,vb,request.profile,options);check();
   const rates=[va,vb].map(v=>{const [n,d]=String(v.avg_frame_rate||'0/1').split('/').map(Number);const rate=n/d;return Number.isFinite(rate)&&rate>0?rate:null});
   clips={duration:12,original,review,frameRates:rates,hdr:va.color_transfer==='smpte2084',previewProfile:request.profile,previewMaxWidth:profile.width,previewMaxHeight:profile.height};
  }else if(request.mode!=='wave')throw Error('Neplatný typ ukázky.');
  const original=await extractAudio(exe,a.path,request.originalIndex,seconds,startA,options);check();
  const review=await extractAudio(exe,b.path,request.reviewIndex,seconds,startB,options);check();
  const result=alignment(original,review);
  return clips?{seconds,...clips,originalWave:original,reviewWave:review,alignment:result}:{seconds,stepMs:10,original,review,alignment:result};
 };
}
