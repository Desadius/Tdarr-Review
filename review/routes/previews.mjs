import {hash,atomicJSON} from '../core.mjs';
import {PREVIEW_PROFILES} from '../av-preview.mjs';
import {validatePreviewSettings,previewLimits} from '../preview-settings.mjs';
import {body,reply,apiError} from './http.mjs';
import {logEvent} from '../log.mjs';

// Sample preparation settings, preparation status and on-demand frames/audio/AV samples.
export async function previewRoutes(ctx,req,res,url,request){
 if(url.pathname==='/api/preview-settings'&&req.method==='GET')return reply(res,200,{config:ctx.previewSettings,revision:hash(JSON.stringify(ctx.previewSettings)),stats:{...ctx.previews.stats(),queued:ctx.previews.stats().queue,running:ctx.previews.stats().busy}});
 if(url.pathname==='/api/preview-settings'&&req.method==='POST'){
  const b=await body(req);if(ctx.busyFor('previewSettings',request.mutation))return reply(res,409,apiError('busy'));if(b.revision!==hash(JSON.stringify(ctx.previewSettings)))return reply(res,409,apiError('settings_changed'));
  let candidate;try{candidate=validatePreviewSettings(b.config)}catch(error){return reply(res,400,{error:error.message})}
  ctx.settingsBusy=true;
  try{
   await atomicJSON(ctx.previewSettingsFile,candidate);ctx.previewSettings=candidate;
   await ctx.previews.updateLimits(previewLimits(candidate));
   await ctx.previews.cancelBackground({all:true,wait:true});ctx.previewPlans.clear();ctx.previewAttempts.clear();
   logEvent('preview-settings.saved',{config:candidate});
   return reply(res,200,{config:ctx.previewSettings,revision:hash(JSON.stringify(ctx.previewSettings)),stats:ctx.previews.stats(),message:'Nastavení přípravy ukázek je uložené.'});
  }finally{ctx.settingsBusy=false;void ctx.preparePreviews().catch(error=>console.error('Preview preparation: '+error.message))}
 }
 const previewStatus=/^\/api\/items\/([a-f0-9]{24})\/preview-status$/.exec(url.pathname);
 if(previewStatus&&req.method==='GET'){
  const id=previewStatus[1],snapshot=url.searchParams.get('snapshot');await ctx.previewIdentity({itemId:id,snapshot,rendererVersion:ctx.previewVersion()});
  return reply(res,200,{preparation:ctx.previewPreparation(id,snapshot)});
 }
 const audio=/^\/api\/items\/([a-f0-9]{24})\/audio-compare$/.exec(url.pathname);
 const frames=/^\/api\/items\/([a-f0-9]{24})\/frames$/.exec(url.pathname);
 if((audio||frames)&&req.method==='POST'){
  const sampleRequest=await body(req),id=(audio||frames)[1],item=ctx.state.items[id];
  if(!item||item.snapshot!==sampleRequest.snapshot)return reply(res,409,apiError('files_changed'));
  // On-demand previews never read a film while it is being replaced.
  if(ctx.itemInOperation(id))return reply(res,409,apiError('item_in_operation'));
  if(sampleRequest.cachedOnly!==undefined&&typeof sampleRequest.cachedOnly!=='boolean')return reply(res,400,apiError('sample_cache_request_invalid'));
  const readonly=sampleRequest.cachedOnly===true||audio&&sampleRequest.mode==='tracks';
  if(!readonly){
   if(ctx.busyFor('preview'))return reply(res,409,apiError('busy_retry'));
   ctx.mutationOwner=request.mutation={kind:'preview'};ctx.previewBusy=true;
  }
  try{
   const mode=frames?'frames':sampleRequest.mode||'wave';
   if(!['frames','tracks','wave','listen','av'].includes(mode))return reply(res,400,apiError('sample_mode_invalid'));
   const normalized={itemId:id,snapshot:sampleRequest.snapshot,mode,seconds:Number(sampleRequest.seconds),originalIndex:frames?null:sampleRequest.originalIndex,reviewIndex:frames?null:sampleRequest.reviewIndex,profile:mode==='av'?sampleRequest.previewProfile??'compact':null,rendererVersion:ctx.previewVersion()};
   const pair=await ctx.previewPair(normalized),tracks=p=>(p.streams||[]).filter(s=>s.codec_type==='audio').map(s=>({index:s.index,label:`${s.index}: ${s.tags?.language||'und'} · ${s.codec_name} · ${s.channels} kan. · ${s.tags?.title||''}`}));
   if(mode==='tracks'){
    if(ctx.previewPlans.get(id)?.snapshot!==sampleRequest.snapshot)await ctx.planPreviewItem(id,sampleRequest.snapshot);
    const preparation=ctx.previewPreparation(id,sampleRequest.snapshot);
    return reply(res,200,{original:tracks(pair.pa),review:tracks(pair.pb),defaultScope:preparation.defaultScope,preparation});
   }
   const duration=Math.min(Number(pair.pa.format?.duration),Number(pair.pb.format?.duration));
   if(!Number.isFinite(normalized.seconds)||normalized.seconds<0||normalized.seconds>=duration||mode!=='frames'&&normalized.seconds+12>duration)return reply(res,400,apiError(mode==='frames'?'frame_time_out_of_range':'sample_time_out_of_range'));
   if(mode!=='frames'&&(!tracks(pair.pa).some(s=>s.index===normalized.originalIndex)||!tracks(pair.pb).some(s=>s.index===normalized.reviewIndex)))return reply(res,400,apiError('sample_tracks_invalid'));
   if(mode==='av'&&!Object.hasOwn(PREVIEW_PROFILES,normalized.profile))return reply(res,400,apiError('sample_profile_invalid'));
   const ready=await ctx.previews.peek(normalized);
   if(readonly){
    if(ready===null)return reply(res,202,{pending:true,preparation:ctx.previewPreparation(id,sampleRequest.snapshot)});
    return reply(res,200,{...ready,cached:true});
   }
   const result=ready??await ctx.previews.request(normalized,{priority:'interactive'});
   await ctx.previewIdentity(normalized);
   // Only an explicit waveform request records a measured sample. Warm-up and cache-only loading do not.
   if(mode==='wave'){
    const sample={seconds:normalized.seconds,originalIndex:normalized.originalIndex,reviewIndex:normalized.reviewIndex,alignment:result.alignment,at:new Date().toISOString()};
    item.audioSamples=[...(item.audioSamples||[]).filter(s=>!(s.seconds===sample.seconds&&s.originalIndex===sample.originalIndex&&s.reviewIndex===sample.reviewIndex)),sample].slice(-30);
    await ctx.save();ctx.cacheAt=0;
   }
   return reply(res,200,{...result,cached:ready!==null});
  }finally{if(!readonly)ctx.previewBusy=false}
 }
 return false;
}
