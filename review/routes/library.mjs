import fs from 'node:fs/promises';
import path from 'node:path';
import {requestArtworkIdentity} from '../artwork.mjs';
import {statistics} from '../stats.mjs';
import {quarantineRetention} from '../../recovery/quarantine-retention.mjs';
import {body,reply,apiError} from './http.mjs';
import {logEvent} from '../log.mjs';
import {readRecoveryRuntime} from '../recovery-snapshot.mjs';
import {settingsRequest} from './shared-settings.mjs';
import {diagnosticExportHeaders} from '../diagnostic-export.mjs';

const RESTORE_RECONCILE_ERRORS=new Set(['restore_reconcile_confirm_required','restore_busy','restore_case_invalid','restore_reconcile_unavailable',
 'restore_fence_owner_changed','restore_case_unavailable','restore_binding_unavailable','restore_binding_changed','restore_case_snapshot_changed','restore_reconcile_confirmation_changed',
 'restore_journal_unproven','restore_case_binding_changed','restore_destination_unproven','restore_source_unproven','restore_link_unproven',
 'restore_unchanged_state_unproven','restore_destination_occupied','recovery_control_unavailable','recovery_restart_unconfirmed',
 'recovery_cancel_unconfirmed','recovery_control_outcome_unknown','recovery_worker_resume_unverified']);

// Posters, statistics, quarantine listing and Radarr replacement requests/settings.
export async function libraryRoutes(ctx,req,res,url,request){
 const poster=/^\/api\/artwork\/(review|request)\/([a-f0-9]{24})$/.exec(url.pathname);
 if(poster&&req.method==='GET'){
  let record;
  if(poster[1]==='review')record=(await ctx.scan()).find(item=>item.id===poster[2]);
  else{
   const visible=(await ctx.replacements.list()).find(item=>item.id===poster[2]);
   if(visible)record=await requestArtworkIdentity(ctx.DATA,visible);
  }
  if(!record)return reply(res,404,apiError('poster_unavailable'));
  const image=await ctx.artwork.lookup(poster[1],record);
  if(!image)return reply(res,404,apiError('poster_unavailable'));
  const headers={'content-type':image.mime,'cache-control':'private, max-age=300','x-content-type-options':'nosniff','x-artwork-status':image.status,'etag':image.etag,'content-security-policy':"default-src 'none'; frame-ancestors 'none'"};
  if(req.headers['if-none-match']===image.etag){res.writeHead(304,headers);res.end();return true;}
  res.writeHead(200,{...headers,'content-length':image.body.length});res.end(image.body);return true;
 }
 if(url.pathname==='/api/statistics'&&req.method==='GET'){
  if(ctx.settingsBusy)return reply(res,409,apiError('settings_changing'));
  if(!ctx.statsCache||Date.now()-ctx.statsCache.at>60000){
   if(!ctx.statsTask)ctx.statsTask=(async()=>{const result=await statistics({dbRows:ctx.dbRows,config:structuredClone(ctx.config),data:ctx.DATA,items:await ctx.scan()});ctx.statsCache=result;return result})().finally(()=>{ctx.statsTask=null});
   await ctx.statsTask;
  }
  return reply(res,200,ctx.statsCache);
 }
 if(url.pathname==='/api/quarantine'&&req.method==='GET'){
  const parent=path.dirname(await fs.realpath(ctx.config.mediaRoot)),settings=await ctx.replacements.publicSettings();
  const roots=[path.join(parent,'.tdarr-corrupt'),settings.quarantineRoot||path.join(parent,'.tdarr-review-quarantine'),path.join(await fs.realpath(ctx.config.reviewRoot),'.radarr-quarantine')];
  const files=[],warnings=[];
  for(const root of [...new Set(roots)]){
   try{
    if(await fs.realpath(root)!==root)throw Error('Karanténa nesmí být symlink.');
    for(const entry of await fs.readdir(root,{withFileTypes:true})){
     if(!entry.isDirectory()||entry.isSymbolicLink())continue;
     const folder=path.join(root,entry.name);if(await fs.realpath(folder)!==folder)continue;
     for(const name of await fs.readdir(folder)){
      const file=path.join(folder,name),st=await fs.lstat(file);
      if(st.isFile()&&!st.isSymbolicLink())files.push({caseId:entry.name,name,path:file,bytes:st.size});
     }
    }
   }catch(e){if(e.code!=='ENOENT')warnings.push('Nelze načíst '+root+': '+e.message);}
  }
  return reply(res,200,{files,warnings,...quarantineRetention});
 }
 if(url.pathname==='/api/radarr/settings'&&req.method==='GET'){const shared=await ctx.sharedSettings.public();return reply(res,200,{...await ctx.replacements.publicSettings(),revision:shared.revision,draft:shared.draft.radarr});}
 if(['/api/radarr/settings','/api/radarr/settings/test'].includes(url.pathname)&&req.method==='POST'){
  return settingsRequest(ctx,res,async save=>{const b=await body(req);if(url.pathname.endsWith('/test')){await ctx.settingsApply.test(b);return reply(res,200,{ok:true});}
   const patch=Object.fromEntries(['url','apiKey','mediaRoot','quarantineRoot','preferCzechEnglish'].filter(k=>Object.hasOwn(b,k)).map(k=>[k,b[k]]));
   await save({revision:b.revision,patch:{radarr:patch},resolutions:b.resolutions||[],acknowledgeHistory:b.acknowledgeHistory});logEvent('radarr-settings.saved',{draft:true,active:false});return reply(res,200,{ok:true,...await ctx.sharedSettings.public()});
  });
 }
 if(url.pathname==='/api/radarr/requests'&&req.method==='GET')return reply(res,200,await ctx.recoveryAttention.attach(await ctx.replacements.overview()));
 // Explicit single-case Diagnostic export (#237): local reads only, a redacted JSON attachment.
 const diagnostic=/^\/api\/cases\/(recovery|radarr)\/([a-f0-9]{24})\/diagnostic-export$/.exec(url.pathname);
 if(diagnostic&&req.method==='GET'){
  const report=await ctx.diagnosticExport.report(diagnostic[1],diagnostic[2]);
  if(!report)return reply(res,404,apiError('diagnostic_case_unavailable'));
  res.writeHead(200,diagnosticExportHeaders(diagnostic[1],diagnostic[2]));res.end(JSON.stringify(report,null,2)+'\n');return true;
 }
 // Read-only first-stage check for an explicit return of one exact Recovery original (#234).
 const originalRestore=/^\/api\/recovery\/cases\/([a-f0-9]{24})\/restore-original$/.exec(url.pathname);
 const deferral=/^\/api\/recovery\/cases\/([a-f0-9]{24})\/defer(\/reopen)?$/.exec(url.pathname);
 if(deferral&&req.method==='POST'){
  const input=await body(req);if(input.confirm!==true)return reply(res,400,apiError('deferral_confirm_required'));
  try{
   const result=deferral[2]?await ctx.recoveryAttention.reopen(deferral[1],{revision:input.revision}):await ctx.recoveryAttention.defer(deferral[1],{revision:input.revision,note:input.note});
   return reply(res,200,{ok:true,...result});
  }catch(error){
   if(['deferral_note_invalid','deferral_confirm_required'].includes(error.code))return reply(res,400,apiError(error.code));
   if(['deferral_stale','deferral_conflict','deferral_unavailable'].includes(error.code))return reply(res,409,apiError(error.code));
   throw error;
  }
 }
 if(originalRestore&&req.method==='GET')return reply(res,200,await ctx.recoverySafeRestore.inspect(originalRestore[1],{busy:!!ctx.busyFor('restore')}));
 const originalRestoreStatus=/^\/api\/recovery\/cases\/([a-f0-9]{24})\/restore-original\/status$/.exec(url.pathname);
 if(originalRestoreStatus&&req.method==='GET')return reply(res,200,await ctx.recoverySafeRestore.status(originalRestoreStatus[1]));
 const originalRestoreReconcile=/^\/api\/recovery\/cases\/([a-f0-9]{24})\/restore-original\/reconcile$/.exec(url.pathname);
 if(originalRestoreReconcile&&req.method==='POST'){
  const input=await body(req),owner=request.mutation||{kind:'restoreReconcile'};
  try{return reply(res,200,await ctx.recoverySafeRestore.reconcile(originalRestoreReconcile[1],{confirm:input.confirm,operationId:input.operationId,revision:input.revision,owner,
   claimBusy:value=>{ctx.mutationOwner=value;request.mutation=null;ctx.setRecoveryRestoreBusy(true);},
   releaseBusy:value=>{if(ctx.mutationOwner===value)ctx.mutationOwner=null;ctx.setRecoveryRestoreBusy(ctx.recoverySafeRestore.busy);}}));}
  catch(error){const code=typeof error.code==='string'?error.code.replaceAll('-','_'):error.code;if(RESTORE_RECONCILE_ERRORS.has(code))return reply(res,code==='restore_reconcile_confirm_required'?400:409,{...apiError(code),...(error.status?{status:error.status}:{})});throw error;}
 }
 if(originalRestore&&req.method==='POST'){
  const input=await body(req),owner=request.mutation||{kind:'restore'};
  try{
   const result=await ctx.recoverySafeRestore.start(originalRestore[1],{confirm:input.confirm,snapshot:input.snapshot,attempt:input.attempt,owner,
    claimBusy:value=>{ctx.mutationOwner=value;request.mutation=null;ctx.setRecoveryRestoreBusy(true);},
    releaseBusy:value=>{if(ctx.mutationOwner===value)ctx.mutationOwner=null;ctx.setRecoveryRestoreBusy(ctx.recoverySafeRestore.busy);}});
   return reply(res,202,result);
  }catch(error){
   const code=typeof error.code==='string'?error.code.replaceAll('-','_'):error.code;
   if(['restore_confirm_required','restore_busy','restore_case_invalid','restore_reconcile_required','restore_snapshot_changed','restore_attempt_changed','restore_not_eligible'].includes(code))return reply(res,code==='restore_confirm_required'?400:409,{...apiError(code),...(error.status?{status:error.status}:{}),...(error.blockers?{blockers:error.blockers}:{})});
   throw error;
  }
 }
 // Read-only refresh of the attention cases named by key (all of them without keys): Radarr, Tdarr, files (#229).
 if(url.pathname==='/api/recovery/refresh'&&req.method==='POST'){
  const b=await body(req),keys=b.keys===undefined?null:b.keys;
  if(keys!==null&&(!Array.isArray(keys)||keys.length>500||keys.some(k=>typeof k!=='string'||!/^(?:recovery|radarr):[a-f0-9]{24}$/.test(k))))return reply(res,400,apiError('refresh_invalid'));
  return reply(res,200,await ctx.recoveryAttention.refresh(await ctx.replacements.overview(),keys));
 }
 // Assessment of an already installed transcoded result (#230). Reading and saving start nothing; approval
 // revalidates every condition and only then writes the approval evidence that starts quarantine retention.
 const installed=/^\/api\/recovery\/cases\/([a-f0-9]{24})\/installed(\/approve)?$/.exec(url.pathname);
 if(installed&&req.method==='GET'&&!installed[2])return reply(res,200,await ctx.installedAssessment.view(installed[1],{busy:!!ctx.busyFor('replace')}));
 if(installed&&req.method==='POST'){
  const b=await body(req),id=installed[1];
  try{
   if(!installed[2])return reply(res,200,await ctx.installedAssessment.save(id,b));
   if(b.confirm!==true)return reply(res,400,apiError('installed_confirm_required'));
   await ctx.scan(true,null,request.mutation);
   const result=await ctx.installedAssessment.approve(id,b);logEvent('installed.approved',{requestId:id});return reply(res,200,{ok:true,...result});
  }catch(e){if(['installed_not_eligible','installed_changed','installed_incomplete'].includes(e.code))return reply(res,409,{...apiError(e.code),blockers:e.blockers||[]});throw e;}
 }
 // Review's handoff of an imported replacement that has no Tdarr row (#231): a read, or a confirmed rescan of that exact file.
 const handoff=/^\/api\/recovery\/cases\/([a-f0-9]{24})\/handoff$/.exec(url.pathname);
 if(handoff&&req.method==='GET')return reply(res,200,await ctx.tdarrHandoff.view(handoff[1],{busy:!!ctx.busyFor('replace')}));
 if(handoff&&req.method==='POST'){
  const b=await body(req);if(b.confirm!==true)return reply(res,400,apiError('handoff_confirm_required'));
  try{const result=await ctx.tdarrHandoff.handoff(handoff[1],b);logEvent('tdarr.handoff',{requestId:handoff[1],state:result.state});return reply(res,200,{ok:true,...result});}
  catch(e){if(['handoff_not_eligible','handoff_changed','handoff_uncertain','handoff_pending'].includes(e.code))return reply(res,409,{...apiError(e.code),blockers:e.blockers||[]});throw e;}
 }
 // The one Review retry of a failed replacement transcode (#232): a diagnosis read, or a confirmed re-queue of that row.
 const retryRequest=/^\/api\/recovery\/cases\/([a-f0-9]{24})\/retry$/.exec(url.pathname);
 if(retryRequest&&req.method==='GET')return reply(res,200,await ctx.transcodeRetry.view(retryRequest[1],{busy:!!ctx.busyFor('replace')}));
 if(retryRequest&&req.method==='POST'){
  const b=await body(req);if(b.confirm!==true)return reply(res,400,apiError('retry_confirm_required'));
  try{const result=await ctx.transcodeRetry.retry(retryRequest[1],b);logEvent('tdarr.retry',{requestId:retryRequest[1],state:result.state});return reply(res,200,{ok:true,...result});}
  catch(e){if(['retry_not_eligible','retry_changed','retry_uncertain','retry_pending'].includes(e.code))return reply(res,409,{...apiError(e.code),blockers:e.blockers||[]});throw e;}
 }
 // Runtime diagnostics remain readable even when the separate case snapshot fails.
 if(url.pathname==='/api/recovery/runtime'&&req.method==='GET')return reply(res,200,await readRecoveryRuntime(path.join(ctx.DATA,'recovery','runtime-state.json')));
 const restoreRequest=/^\/api\/radarr\/requests\/([a-f0-9]{24})\/restore$/.exec(url.pathname);
 if(restoreRequest&&req.method==='POST'){
  const b=await body(req);if(b.confirm!==true)return reply(res,400,apiError('restore_confirm_required'));
  if(ctx.busyFor('restore',request.mutation))return reply(res,409,apiError('busy'));
  ctx.active={title:'Obnovení karantény',stage:'Ověřuji soubory',started:Date.now()};
  try{const result=await ctx.replacements.restore(restoreRequest[1]);logEvent('quarantine.restored',{requestId:restoreRequest[1],id:result.itemId});await ctx.forgetPreviews(result.itemId);delete ctx.state.items[result.itemId];delete ctx.state.reviewSessions[result.itemId];await ctx.save();return reply(res,200,result)}finally{ctx.active=null;ctx.cache=null}
 }
 return false;
}
