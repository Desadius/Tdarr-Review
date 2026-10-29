import path from 'node:path';
import {rejectionReason} from './rejection-audit.mjs';
import {durationException} from './recheck.mjs';
import {forgetApproval} from './approvals.mjs';

// The approval and rejection transaction of one film. It orders, for an approval: review evidence,
// the pending-recovery check, re-hash of both files against the snapshot, the Tdarr busy check, the
// review receipt, the duration check, pausing Tdarr dispatch, the journaled replacement
// (replaceChecked, which checks the pause again right before its commit), approval evidence and the
// Tdarr rescan; for a rejection: removal of the review copy only, archived before and after. Both end
// with review cleanup, history, the decision audit or rejection archive, and a resume of the nodes
// unless an exchange is left unfinished. The server owns its state, busy policy, batch and queue and
// hands everything else in as adapters, so the ordering can be driven in-process.

// Operator log of a finished approval, rejection or replacement request (never review evidence).
export const outcomeLog=o=>({id:o.id,title:o.title,action:o.action,outcome:o.status,message:o.message,warning:o.warning,requestId:o.requestId,jobId:o.jobId,reason:o.rejectionReason,elapsedSeconds:o.elapsedSeconds,savedBytes:o.savedBytes});
export const auditFailed=(outcome,error)=>{outcome.warning=[outcome.warning,'Uložení záznamu do auditu rozhodnutí selhalo: '+error.message].filter(Boolean).join(' ')};

const labels={'preparing':['Kopíruji výsledek do složky filmu',3],'syncing-copy':['Čekám na dokončení zápisu na disk',3],'verifying-copy':['Porovnávám kontrolní součty obou kopií',4],'ready':['Připravuji výměnu',5],'original-backed-up':['Nahrazuji originál',5],'installed':['Dokončuji výměnu',5],'original-removed':['Odstraňuji hotovou review kopii',5],'complete':['Soubor je nahrazený',5]};

/**
 * @param {object} adapters
 * @param {()=>any} adapters.getState Review state: items, reviewSessions, approvals, history.
 * @param {()=>any} adapters.getConfig Review configuration (libraryId, sourceRoots, reviewPrefixes).
 * @param {any[]} adapters.recovery Unresolved exchange transactions; an unfinished journal is added here.
 * @param {{approval:(id:string,snapshot:string,revision:number)=>any}} adapters.reviewSessions
 * @param {object} adapters.files media(), review(), safeFile, hash, captureReceipt, cleanupReviewed, unlink, probe(file), inspect, replaceChecked, newJournal(), readJournal(journal); optional snapshotMatches(item,source,result) for library-specific snapshots.
 * @param {object} adapters.tdarr nodes(), workerBusy(nodes,item), pauseDispatch(item), verifyPaused(item), resume(), libraries(), rescan(body).
 * @param {object} adapters.records publishApproval(entry), recordRejection(entry), recordDecision(entry).
 * @param {object} adapters.activity start(entry), progress(stage,step,phase), measured(progress), finish().
 * @param {(event:string,fields:object)=>void} adapters.log
 * @param {(id:string)=>Promise<void>} adapters.forgetPreviews
 * @param {()=>void} adapters.invalidateStats
 * @param {()=>Promise<void>} adapters.save
 * @param {()=>void} adapters.next Runs after the action has finished (the replacement queue).
 * @param {()=>number} [adapters.now]
 */
export function createApprovalTransaction({getState,getConfig,recovery,reviewSessions,files,tdarr,records,activity,log,forgetPreviews,invalidateStats,save,next,now=Date.now}){
 const {progress}=activity;
 return async function perform(action,item,acceptDuration=false,reason){
  const state=getState();
  if(action==='reject')reason=rejectionReason(reason);
  const previous=state.items[item.id],started=now();
  activity.start({id:item.id,title:item.title,action,stage:'Ověřuji soubory',started});
  log('action.started',{action,id:item.id,title:item.title,acceptDuration:acceptDuration||undefined});
  await forgetPreviews(item.id);
  progress('Ověřuji soubory, délku a zachované stopy');
  let journal,warning,outcome,reviewEvidence,tdarrRefreshFailed=false;
  try {
    if(action==='approve')reviewEvidence=reviewSessions.approval(item.id,item.snapshot,item.reviewRevision);
    if(recovery.length)throw new Error('Je nutné dokončit obnovu předchozí výměny.');
    if(action==='approve'&&tdarr.validateLibrary)await tdarr.validateLibrary(item);
    const a=await files.safeFile(files.media(),item.relative),b=await files.safeFile(files.review(),item.reviewRelative);
    if(files.snapshotMatches?!files.snapshotMatches(item,a,b):files.hash(a.fp+'|'+b.fp)!==item.snapshot)throw new Error('Soubory se změnily. Obnov přehled.');
    const nodes=await tdarr.nodes();if(tdarr.workerBusy(nodes,item))throw new Error('Tento film právě zpracovává Tdarr. Zkus akci po dokončení.');
    const receipt=await files.captureReceipt(files.review(),item.reviewRelative,item.relative,b.stat);
    if(action==='reject'){
      progress('Odstraňuji pouze review kopii');
      if((await files.safeFile(files.review(),item.reviewRelative)).fp!==b.fp)throw new Error('Review soubor se změnil.');
      await records.recordRejection({event:'requested',id:item.id,title:item.title,action,reason,jobId:item.jobId||previous?.jobId,relative:item.relative,reviewRelative:item.reviewRelative,snapshot:item.snapshot,originalBytes:item.originalBytes,reviewBytes:item.reviewBytes,assessment:item.assessment});
      await files.unlink(b.path);
    } else {
      // Tdarr performs the full health check; Review only verifies metadata and safe replacement.
      const info=files.inspect(await files.probe(a.path),await files.probe(b.path));
      if(info.durationMismatch&&!(acceptDuration&&item.canApproveDuration&&durationException(info)))throw new Error('Rozdílnou délku nelze schválit bez zvláštní kontroly.');
      progress('Pozastavuji přijímání nových úloh v Tdarru',2,'pause');
      await tdarr.pauseDispatch(item);
      journal=files.newJournal();
      const tvAudit=files.tvAuditContext?.({action,item,previous,reviewEvidence,journal});
      await files.replaceChecked({original:a.path,review:b.path,destination:item.outputRelative&&item.outputRelative!==item.relative?path.join(path.dirname(a.path),path.basename(item.outputRelative)):a.path,originalFP:previous.originalFP,reviewFP:previous.reviewFP,journal,...(tvAudit?{tvAudit,beforeMediaMutation:record=>files.beforeTvMediaMutation?.({journal,record,item})}:{}),onStage:s=>progress(labels[s][0],labels[s][1],s),onProgress:activity.measured,beforeCommit:()=>tdarr.verifyPaused(item)});
      try{await records.publishApproval({mediaRoot:files.media(),relative:item.relative,sourceFP:previous.originalFP,installedRelative:item.outputRelative||item.relative})}catch(e){warning='Film je schválený, ale důkaz pro úklid karantény se neuložil: '+e.message}
      progress('Obnovuji údaje filmu v Tdarru',6,'rescan');
      try {
        const config=getConfig(),lib=tdarr.resolveLibrary?await tdarr.resolveLibrary(config,item):(await tdarr.libraries()).find(l=>config.libraryId?l._id===config.libraryId:config.sourceRoots.includes(String(l.folder).replace(/\/$/,'')));
        if(lib)await tdarr.rescan({_id:String(lib.folder).replace(/\/$/,'')+'/'+(item.outputRelative||item.relative),DB:lib._id});
      }catch(e){tdarrRefreshFailed=true;warning='Film je nahrazený, ale aktualizace údajů v Tdarru selhala: '+e.message;}
    }
    progress('Uklízím prázdné složky review',6,'cleanup');
    try{await files.cleanupReviewed(files.review(),item.reviewRelative,receipt,getConfig().reviewPrefixes)}catch(e){warning=[warning,'Film je vyřízený, ale úklid review selhal: '+e.message].filter(Boolean).join(' ')}
    outcome={id:item.id,title:item.title,action,rejectionReason:action==='reject'?reason:undefined,jobId:item.jobId||previous?.jobId,reviewSession:reviewEvidence,acceptedDurationDifference:acceptDuration?item.durationA-item.durationB:undefined,status:'success',warning,tdarrRefreshFailed:tdarrRefreshFailed||undefined,time:new Date(now()).toISOString(),elapsedSeconds:Math.round((now()-started)/1000),savedBytes:action==='approve'?item.originalBytes-item.reviewBytes:0};state.history.unshift(outcome);
    delete state.items[item.id];delete state.reviewSessions[item.id];forgetApproval(state,item.id);invalidateStats();
  }catch(e){
    outcome={id:item.id,title:item.title,action,rejectionReason:action==='reject'?reason:undefined,jobId:item.jobId||previous?.jobId,reviewSession:reviewEvidence,status:'error',message:e.message,time:new Date(now()).toISOString()};state.history.unshift(outcome);
    if(journal){const t=await files.readJournal(journal);if(!['aborted','complete'].includes(t.phase)){recovery.push({...t,id:t.id||'unknown',journal});log('transaction.unresolved',{transaction:t.id||'unknown',phase:t.phase,id:item.id,title:item.title})}}
  }finally{
    if(files.tvAuditContext&&journal)outcome.transactionRef=path.basename(journal);
    if(action==='reject'){try{await records.recordRejection({event:'completed',...outcome})}catch(e){outcome.warning=[outcome.warning,'Uložení výsledku do archivu zamítnutí selhalo: '+e.message].filter(Boolean).join(' ');}}
    if(action==='approve'){try{await records.recordDecision({event:'approval',id:item.id,title:item.title,relative:item.relative,outputRelative:item.outputRelative,reviewRelative:item.reviewRelative,snapshot:item.snapshot,jobId:outcome.jobId,originalBytes:item.originalBytes,reviewBytes:item.reviewBytes,reviewSession:reviewEvidence,acceptedDurationDifference:outcome.acceptedDurationDifference,transaction:journal?path.basename(journal,'.json'):null,outcome:outcome.status,message:outcome.message,warning:outcome.warning,savedBytes:outcome.savedBytes,elapsedSeconds:outcome.elapsedSeconds})}catch(e){auditFailed(outcome,e)}}if(!recovery.length){progress('Obnovuji původní stav nodů',6,'resume');await tdarr.resume()}state.history=state.history.slice(0,150);await save();activity.finish();log('action.finished',outcomeLog(outcome));next()}
  return outcome;
 };
}
