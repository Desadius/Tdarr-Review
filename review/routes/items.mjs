import path from 'node:path';
import {recordApproval,currentApproval,publicApprovals} from '../approvals.mjs';
import {logEvent} from '../log.mjs';
import {unresolvedTransactions} from '../unresolved-transactions.mjs';
import {createReadStream} from 'node:fs';
import {safeFile} from '../core.mjs';
import {rejectionReason} from '../rejection-audit.mjs';
import {body,reply,apiError} from './http.mjs';

// Review items: listing, saved review sessions and the approve/reject/replace/recheck actions.
// Every action rescans with its own reservation and starts only after its busy policy passes.
// A listed item whose files changed since it was queued is offered for verification, never for review.
const needsVerification=async(ctx,id,snapshot)=>(await ctx.scan()).some(x=>x.id===id&&x.snapshot===snapshot&&x.identityChanged===true);
export async function itemRoutes(ctx,req,res,url,request){
 const replaceRequest=/^\/api\/items\/([a-f0-9]{24})\/replace$/.exec(url.pathname);
 if(replaceRequest&&req.method==='POST'){
  const b=await body(req);let reason;try{reason=rejectionReason(b.reason)}catch(e){return reply(res,400,{error:e.message})}
  const item=(await ctx.scan(true,null,request.mutation)).find(v=>v.id===replaceRequest[1]);
  if(!item?.snapshot||item.snapshot!==b.snapshot)return reply(res,409,apiError('item_changed'));
  if(ctx.busyFor('replace',request.mutation))return reply(res,409,apiError('busy'));
  void ctx.replacementAction(item,reason);return reply(res,202,{ok:true});
 }
 if(url.pathname==='/api/items'&&req.method==='GET'){
  const items=await ctx.scan();
  return reply(res,200,{version:ctx.APP_VERSION,label:ctx.config.label,serverTime:Date.now(),items,previews:Object.fromEntries(items.filter(item=>item.snapshot).map(item=>[item.id,ctx.previewPreparation(item.id,item.snapshot)])),reviewSessions:ctx.reviewSessions.list(items.filter(item=>!item.identityChanged)),approvals:publicApprovals(ctx.state,items.filter(item=>!item.identityChanged),ctx.reviewSessions.list(items.filter(item=>!item.identityChanged))),active:ctx.active,batch:ctx.state.batch||null,batchRunning:ctx.batchRunning,history:ctx.state.history,recovery:unresolvedTransactions(ctx.recovery,items,ctx.config.mediaRoot),restorePending:ctx.state.pauses.length,pendingRestores:ctx.pendingRestores()});
 }
 const reviewSession=/^\/api\/items\/([a-f0-9]{24})\/review-session$/.exec(url.pathname);
 if(reviewSession&&req.method==='GET'){
  const id=reviewSession[1],snapshot=url.searchParams.get('snapshot'),item=ctx.state.items[id];
  if(!item||item.snapshot!==snapshot)return reply(res,409,apiError(await needsVerification(ctx,id,snapshot)?'item_needs_verification':'item_changed'));
  const verified=await ctx.verifyReviewItem(item,{id,snapshot},false);
  return reply(res,200,ctx.reviewSessions.get(id,snapshot,verified.requirements));
 }
 if(reviewSession&&req.method==='POST'){
  if(ctx.itemInOperation(reviewSession[1]))return reply(res,409,apiError('item_in_operation'));
  if(ctx.reviewMutationBlocked())return reply(res,409,apiError('finish_action_or_recovery'));
  const sessionRequest=await body(req);
  if(ctx.reviewMutationBlocked())return reply(res,409,apiError('finish_action_or_recovery'));
  if(typeof sessionRequest?.snapshot==='string'&&await needsVerification(ctx,reviewSession[1],sessionRequest.snapshot))return reply(res,409,apiError('item_needs_verification'));
  const saved=await ctx.reviewSessions.write(reviewSession[1],sessionRequest);void ctx.preparePreviews().catch(error=>console.error('Preview preparation: '+error.message));return reply(res,200,saved);
 }
 if(url.pathname==='/api/approve-batch'&&req.method==='POST'){
  const b=await body(req);
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)return reply(res,400,apiError('batch_size'));
  if(new Set(b.items.map(x=>x.id)).size!==b.items.length)return reply(res,400,apiError('batch_duplicate'));
  const list=await ctx.scan(true,null,request.mutation),items=[];
  for(const chosen of b.items){const item=list.find(x=>x.id===chosen.id);if(!item||item.status!=='ready'||item.snapshot!==chosen.snapshot)return reply(res,409,apiError('batch_item_changed'));ctx.reviewSessions.approval(item.id,item.snapshot,chosen.reviewRevision);
   // Batch replacement takes only films explicitly approved for exactly this snapshot and review revision.
   if(!currentApproval(ctx.state,item,chosen.reviewRevision))return reply(res,409,apiError('batch_item_not_approved'));items.push({...item,reviewRevision:chosen.reviewRevision})}
  if(ctx.busyFor('batch',request.mutation))return reply(res,409,apiError('busy_action_or_batch'));
  void ctx.performBatch(items);
  return reply(res,202,{ok:true,count:items.length});
 }
 const recheck=/^\/api\/items\/([a-f0-9]{24})\/recheck$/.exec(url.pathname);
 if(recheck&&req.method==='POST'){
  const b=await body(req),list=await ctx.scan(true,null,request.mutation),item=list.find(x=>x.id===recheck[1]);
  if(!item?.canRecheck||item.snapshot!==b.snapshot)return reply(res,409,apiError('recheck_unsafe'));
  if(ctx.busyFor('recheck',request.mutation))return reply(res,409,apiError('busy_action'));
  const refreshed=(await ctx.scan(true,item.id,request.mutation)).find(x=>x.id===item.id);
  if(!refreshed||refreshed.identityChanged)return reply(res,409,{...apiError('recheck_failed'),reason:refreshed?.reason||null});
  return reply(res,200,{ok:true,item:refreshed});
 }
 const approval=/^\/api\/items\/([a-f0-9]{24})\/approval$/.exec(url.pathname);
 if(approval&&req.method==='POST'){
  // Records the decision only: no file is moved, copied or deleted and no replacement is scheduled.
  if(ctx.itemInOperation(approval[1]))return reply(res,409,apiError('item_in_operation'));
  if(ctx.reviewMutationBlocked())return reply(res,409,apiError('finish_action_or_recovery'));
  const b=await body(req),list=await ctx.scan(true,null,request.mutation),item=list.find(x=>x.id===approval[1]);
  if(!item||!item.snapshot||item.snapshot!==b.snapshot)return reply(res,409,apiError(item?.identityChanged?'item_needs_verification':'item_changed'));
  if(item.status!=='ready')return reply(res,409,apiError('approval_individual_only'));
  if(!ctx.state.items[item.id])return reply(res,409,apiError('item_unmapped'));
  ctx.reviewSessions.approval(item.id,item.snapshot,b.reviewRevision);
  const record=recordApproval(ctx.state,{id:item.id,snapshot:item.snapshot,reviewRevision:b.reviewRevision});await ctx.save();
  logEvent('item.approved',{id:item.id,title:item.title,snapshot:item.snapshot,reviewRevision:b.reviewRevision});
  return reply(res,200,{ok:true,approval:{approvedAt:record.approvedAt,reviewRevision:record.reviewRevision}});
 }
 const action=/^\/api\/items\/([a-f0-9]{24})\/(approve|reject)$/.exec(url.pathname);
 if(action&&req.method==='POST'){
  const b=await body(req);
  let reason;if(action[2]==='reject'){try{reason=rejectionReason(b.reason)}catch(e){return reply(res,400,{error:e.message})}}
  const list=await ctx.scan(true,null,request.mutation),item=list.find(x=>x.id===action[1]);
  if(!item||!item.snapshot||item.snapshot!==b.snapshot)return reply(res,409,apiError('item_changed'));
  const acceptDuration=action[2]==='approve'&&b.acceptDuration===true&&item.canApproveDuration===true;
  if(action[2]==='approve'&&item.status!=='ready'&&!acceptDuration)return reply(res,409,{error:item.reason});
  if(!ctx.state.items[item.id])return reply(res,409,apiError('item_unmapped'));
  if(action[2]==='approve')ctx.reviewSessions.approval(item.id,item.snapshot,b.reviewRevision);
  // Claim before yielding so two simultaneous clicks cannot start two transactions.
  if(ctx.busyFor(action[2],request.mutation))return reply(res,409,apiError('busy_action_or_batch'));
  void ctx.perform(action[2],{...item,reviewRevision:b.reviewRevision},acceptDuration,reason);
  return reply(res,202,{ok:true});
 }
 const video=/^\/api\/items\/([a-f0-9]{24})\/video$/.exec(url.pathname);
 if(video&&req.method==='GET'){
  const item=(await ctx.scan()).find(x=>x.id===video[1]);if(!item)return reply(res,404,apiError('file_not_found'));
  const f=await safeFile(ctx.REVIEW,item.reviewRelative);
  res.writeHead(200,{'content-type':'video/x-matroska','content-length':f.stat.size,'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(path.basename(f.path)),'cache-control':'no-store','x-content-type-options':'nosniff'});
  const stream=createReadStream(f.path);res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);return true;
 }
 return false;
}
