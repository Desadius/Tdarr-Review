import {reply,apiError,body} from './http.mjs';
import {createReadStream} from 'node:fs';
import path from 'node:path';

function publicReviewItem(item){
 return {id:item.id,title:item.title,snapshot:item.snapshot,status:'ready',originalBytes:item.originalBytes,reviewBytes:item.reviewBytes,durationA:item.info.durationA,durationB:item.info.durationB,videoSummary:item.info.videoSummary,audio:item.resultProbe.streams.filter(stream=>stream.codec_type==='audio').map(stream=>stream.tags?.language||'unmarked'),subtitles:item.resultProbe.streams.filter(stream=>stream.codec_type==='subtitle').map(stream=>stream.tags?.language||'unmarked'),canApproveDuration:false};
}

// TV discovery remains read-only; strict-review routes expose only separate assessment,
// approval and installation operations for supported, freshly bound episodes.
export async function tvRoutes(ctx,req,res,url,httpRequest={}){
 if(req.method==='GET'&&url.pathname==='/api/tv/season-sample-plan'){
  const keys=[...url.searchParams.keys()];
  if(keys.some(key=>!['settingsRevision','discoveryRevision','seriesId','seasonNumber'].includes(key))||keys.some(key=>url.searchParams.getAll(key).length!==1))return reply(res,400,apiError('tv_invalid_request'));
  const seriesId=url.searchParams.get('seriesId'),seasonNumber=url.searchParams.get('seasonNumber');
  if(!/^[1-9]\d{0,14}$/.test(seriesId||'')||!/^(?:0|[1-9]\d{0,8})$/.test(seasonNumber||''))return reply(res,400,apiError('tv_invalid_request'));
  const controller=new AbortController();
  const cancel=()=>{if(!res.writableFinished)controller.abort()};res.once('close',cancel);
  try{
   const plan=await ctx.tvSeasonSampleService.create({settingsRevision:url.searchParams.get('settingsRevision'),discoveryRevision:url.searchParams.get('discoveryRevision'),seriesId:Number(seriesId),seasonNumber:Number(seasonNumber)},{signal:controller.signal});
   return reply(res,200,plan);
  }catch(error){
   const codes=new Set(['tv_plan_busy','settings_conflict','settings_not_applied','tv_plan_stale_discovery','tv_plan_sonarr_unavailable','tv_plan_sonarr_inconsistent','tv_plan_series_root_unsafe','tv_plan_pair_limit','tv_plan_row_limit','tv_plan_deadline','tv_plan_cancelled','tv_plan_evidence_unavailable','tv_plan_probe_incomplete','tv_plan_sonarr_changed','tv_plan_job_changed','tv_plan_files_changed','tv_plan_unavailable']);
   const status=error.code==='tv_plan_pair_limit'||error.code==='tv_plan_row_limit'?413:['settings_conflict','settings_not_applied','tv_plan_stale_discovery','tv_plan_sonarr_changed','tv_plan_job_changed','tv_plan_files_changed'].includes(error.code)?409:503;
   return reply(res,status,apiError(codes.has(error.code)?error.code:'tv_plan_unavailable'));
  }finally{res.removeListener('close',cancel)}
 }
 const video=/^\/api\/tv\/([a-f0-9]{24})\/video$/.exec(url.pathname);
 if(video&&req.method==='GET'){
  if(ctx.tvDiscovery.mode()!=='strict-review')return reply(res,409,apiError('tv_review_disabled'));
  try{
   const item=await ctx.refreshTvReviewItem(video[1]),file=await ctx.safeFile(ctx.tvSettings.reviewRoot,item.reviewRelative);
   res.writeHead(200,{'content-type':'video/x-matroska','content-length':file.stat.size,'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(path.basename(file.path)),'cache-control':'no-store','x-content-type-options':'nosniff'});
   const stream=createReadStream(file.path);res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);return true;
  }catch(error){return reply(res,error.status||409,apiError(error.code||'tv_review_unavailable'))}
 }
 const review=/^\/api\/tv\/([a-f0-9]{24})\/review-session$/.exec(url.pathname);
 if(review&&['GET','POST'].includes(req.method)){
  if(ctx.tvDiscovery.mode()!=='strict-review')return reply(res,409,apiError('tv_review_disabled'));
  const id=review[1];
  try{
   if(req.method==='GET'){
    const item=await ctx.refreshTvReviewItem(id),snapshot=url.searchParams.get('snapshot');
    if(snapshot!==item.snapshot)return reply(res,409,apiError('item_changed'));
    return reply(res,200,{...ctx.tvReviewSessions.get(id,item.snapshot,{hdr:false}),item:publicReviewItem(item),approval:ctx.tvWorkflowState.approvals[id]||null});
   }
   if(ctx.itemInOperation(id)||ctx.reviewMutationBlocked(httpRequest.mutation))return reply(res,409,apiError('item_in_operation'));
   const request=await body(req),item=await ctx.refreshTvReviewItem(id);
   if(item.snapshot!==request.snapshot)return reply(res,409,apiError('item_changed'));
   ctx.tvWorkflowState.items[id]=item;
   const saved=await ctx.tvReviewSessions.write(id,request);
   if(ctx.tvWorkflowState.approvals[id]?.reviewRevision!==saved.revision){delete ctx.tvWorkflowState.approvals[id];await ctx.save()}
   return reply(res,200,{...saved,approval:ctx.tvWorkflowState.approvals[id]||null});
  }catch(error){return reply(res,error.status||409,apiError(error.code||'tv_review_unavailable'))}
 }
 const approval=/^\/api\/tv\/([a-f0-9]{24})\/approval$/.exec(url.pathname);
 if(approval&&req.method==='POST'){
  if(ctx.tvDiscovery.mode()!=='strict-review')return reply(res,409,apiError('tv_review_disabled'));
  const id=approval[1],request=await body(req);
  if(ctx.itemInOperation(id)||ctx.reviewMutationBlocked(httpRequest.mutation))return reply(res,409,apiError('item_in_operation'));
  try{
   const item=await ctx.refreshTvReviewItem(id);if(item.snapshot!==request.snapshot)return reply(res,409,apiError('item_changed'));
   const evidence=ctx.tvReviewSessions.approval(id,item.snapshot,request.reviewRevision);
   const approved={snapshot:item.snapshot,reviewRevision:evidence.revision,approvedAt:new Date().toISOString(),settingsGeneration:item.settingsGeneration,flowProofHash:item.flowProofHash,jobEvidenceHash:item.jobEvidenceHash,seriesId:item.seriesId,episodeFileId:item.episodeFileId,episodeIds:[...item.episodeIds]};
   ctx.tvWorkflowState.approvals[id]=approved;await ctx.save();return reply(res,200,{ok:true,approval:approved});
  }catch(error){return reply(res,error.status||409,apiError(error.code||'tv_approval_unavailable'))}
 }
 const install=/^\/api\/tv\/([a-f0-9]{24})\/install$/.exec(url.pathname);
 if(install&&req.method==='POST'){
  if(ctx.tvDiscovery.mode()!=='strict-review')return reply(res,409,apiError('tv_review_disabled'));
  const id=install[1],request=await body(req);
  if(ctx.itemInOperation(id)||ctx.busyFor('approve',httpRequest.mutation))return reply(res,409,apiError('item_in_operation'));
  try{
   const item=await ctx.refreshTvReviewItem(id),approval=ctx.tvWorkflowState.approvals[id];
   if(item.snapshot!==request.snapshot||!approval||approval.snapshot!==item.snapshot||approval.settingsGeneration!==item.settingsGeneration||approval.flowProofHash!==item.flowProofHash||approval.jobEvidenceHash!==item.jobEvidenceHash||approval.seriesId!==item.seriesId||approval.episodeFileId!==item.episodeFileId||JSON.stringify(approval.episodeIds)!==JSON.stringify(item.episodeIds)||approval.reviewRevision!==request.reviewRevision)return reply(res,409,apiError('approval_required'));
   const evidence=ctx.tvReviewSessions.approval(id,item.snapshot,request.reviewRevision);
   await ctx.validateTvLibrary(item);
   ctx.tvWorkflowState.items[id]=item;
   void ctx.performTvInstall({...item,reviewRevision:evidence.revision,acceptedApproval:structuredClone(approval)});
   return reply(res,202,{ok:true,installing:true});
  }catch(error){return reply(res,error.status||409,apiError(error.code||'tv_install_unavailable'))}
 }
 if(req.method==='GET'&&url.pathname==='/api/tv/installations'){
  const keys=[...url.searchParams.keys()];if(keys.some(key=>!['limit','cursor'].includes(key))||url.searchParams.getAll('limit').length>1||url.searchParams.getAll('cursor').length>1)return reply(res,400,apiError('tv_invalid_request'));
  const rawLimit=url.searchParams.get('limit'),limit=rawLimit===null?20:/^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit)?Number(rawLimit):NaN;
  if(!Number.isSafeInteger(limit))return reply(res,400,apiError('tv_invalid_request'));
  try{
   const page=await ctx.tvInstallLedger.page({limit,cursor:url.searchParams.has('cursor')?url.searchParams.get('cursor'):undefined});
   const indexPresent=await ctx.tvInstallLedger.hasIndex();
   const legacyUnverified=ctx.tvWorkflowState.history.filter(value=>!indexPresent||typeof value.transactionRef!=='string').slice(0,20).map(value=>({verification:'unverified',status:typeof value.status==='string'&&['success','error','incomplete_refresh'].includes(value.status)?value.status:'unknown',time:typeof value.time==='string'&&Number.isFinite(Date.parse(value.time))?new Date(value.time).toISOString():'',reason:'legacy_history_unbound'}));
   return reply(res,200,{mode:ctx.tvDiscovery.mode(),...page,legacyUnverified,legacyLimit:20,inventoryScope:'indexed_transactions_only'});
  }catch(error){return reply(res,error.status||500,apiError(error.status===400?'tv_invalid_request':'tv_install_ledger_unavailable'))}
 }
 if(req.method!=='GET'||!['/api/tv','/api/tv/status'].includes(url.pathname))return false;
 if(url.pathname==='/api/tv/status')return reply(res,200,{mode:ctx.tvDiscovery.mode(),installationsAvailable:(await ctx.tvInstallLedger.hasIndex())||ctx.tvWorkflowState.history.length>0,active:ctx.active?.library==='tv'?{id:ctx.active.id,action:ctx.active.action,stage:ctx.active.stage}:null,history:ctx.tvWorkflowState.history.slice(0,20).map(value=>({id:/^[a-f0-9]{24}$/.test(value.id||'')?value.id:null,status:['success','error','incomplete_refresh'].includes(value.status)?value.status:'unknown',time:typeof value.time==='string'&&Number.isFinite(Date.parse(value.time))?new Date(value.time).toISOString():'',refresh:['pending','completed','failed'].includes(value.refresh)?value.refresh:undefined}))});
 const keys=[...url.searchParams.keys()];
 if(keys.some(key=>key!=='refresh')||url.searchParams.getAll('refresh').length>1||!['',null,'1'].includes(url.searchParams.get('refresh')))return reply(res,400,apiError('tv_invalid_request'));
 const overview=await ctx.tvDiscovery.result({force:url.searchParams.get('refresh')==='1'}),publicOverview=structuredClone(overview);
 if(publicOverview.status!=='unavailable'&&ctx.tvDiscovery.mode()==='strict-review')for(const series of publicOverview.series||[])for(const season of series.seasons||[])for(const item of season.results||[])item.strictBlockReason=await ctx.tvStrictBlockReason(item);
 const canPlan=ctx.tvDiscovery.mode()==='strict-review'&&publicOverview.status==='ok';
 const planContext=canPlan?await ctx.pinTvDiscovery(publicOverview):null;
 return reply(res,200,{...publicOverview,...(planContext?{planContext}:{}),active:ctx.active?.library==='tv'?{id:ctx.active.id,action:ctx.active.action,stage:ctx.active.stage}:null,history:ctx.tvWorkflowState.history.slice(0,20).map(value=>({id:value.id,status:value.status,time:value.time,refresh:value.refresh}))});
}
