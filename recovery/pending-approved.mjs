import {bindHistory} from './policy.mjs';
import {frozenConfigDifference} from './frozen-config.mjs';
export function approvedBind(movie,history,target,size,a){
 if(movie.id!==a.movieId||movie.movieFileId!==a.movieFileId||!movie.monitored||!movie.movieFile||movie.movieFile.id!==a.movieFileId||movie.movieFile.path!==target||movie.movieFile.size!==a.size||size!==a.size||movie.movieFile.sceneName!==a.sourceTitle)throw Error('Current source does not match frozen approval');
 const imports=history.filter(h=>h.eventType==='downloadFolderImported'&&h.id===a.importId&&h.movieId===a.movieId&&String(h.data?.fileId)===String(a.movieFileId)&&h.data?.importedPath===target&&h.downloadId===a.downloadId&&h.sourceTitle===a.sourceTitle);
 if(imports.length!==1)throw Error('Import history does not match approval');
 if(!a.legacyMissingImportSize)return bindHistory(movie,history,target,size);
 if(imports[0].data.size!==undefined&&imports[0].data.size!==null&&imports[0].data.size!=='')throw Error('Legacy size exception cannot bypass a present or changed value');
 const grabs=history.filter(h=>h.eventType==='grabbed'&&h.id===a.grabId&&h.movieId===a.movieId&&h.downloadId===a.downloadId&&h.sourceTitle===a.sourceTitle);
 if(grabs.length!==1)throw Error('Ambiguous grabbed release');
 const g=grabs[0];if(!g.data?.publishedDate||!g.data?.indexer||!Number(g.data?.size)||!['1','2'].includes(String(g.data?.protocol)))throw Error('Incomplete grabbed identity');
 return {historyId:g.id,sourceTitle:g.sourceTitle,downloadId:g.downloadId,indexer:g.data.indexer,size:Number(g.data.size),protocol:Number(g.data.protocol),publishedDate:g.data.publishedDate,movieFileId:a.movieFileId};
}

export function validatePending(a){
 if((!Number.isInteger(a.movieId)||a.movieId<=0)||!a.authorization||!a.fp||a.checks?.length!==2)throw Error('Unapproved pending case');
 if(!a.checks.some(c=>c.version.includes('7.1.4'))||!a.checks.some(c=>c.version.includes('9.0.2')))throw Error('Missing diagnostic versions');
 for(const c of a.checks)if(c.file!==a.file||c.bytes!==a.size||!c.sourceUnchanged||!c.hostIdentityUnchanged||c.timeout||!c.decodeMarkers.includes(a.signature)||/Permission denied|Input[/]output error|No such file|Connection reset|No space left|Out of memory/i.test(c.stderrTail||''))throw Error('Ineligible source evidence');
 if(!['quant_step_size larger than huff_lsbs','Read past end of XLL band data'].includes(a.signature))throw Error('Unsupported signature');
}
export const quotaAvailable=(state,limit,now=Date.now())=>Number.isInteger(limit)&&limit>0&&Object.values(state.cases||{}).filter(c=>c.mutationStarted&&now-c.mutationStarted<86400000).length<limit;
export async function processPending({approvals,cfg,state,safeSource,identity,phase,repair}){
 const changed=frozenConfigDifference(approvals.config,cfg);if(changed!==null)throw Error('Pending recovery mapping changed '+changed);
 if(!cfg.enabled)return;
 for(const a of approvals.cases){let c=state.cases[a.id];if(c&&c.status!=='deferred_limit')continue;
  try{validatePending(a);const s=await safeSource(a.relative);if(s.fp!==a.fp||s.size!==a.size||identity(a.file,s.fp)!==a.id)throw Error('Frozen identity changed');
   c=state.cases[a.id]||(state.cases[a.id]={id:a.id,file:a.file,relative:a.relative,source:s.p,size:s.size,fp:s.fp,approval:a,created:new Date().toISOString()});
   if(!quotaAvailable(state,cfg.maxRepairsPerDay)){if(c.status!=='deferred_limit')await phase(c,'deferred_limit','Potvrzená chyba originálu; obnova čeká na uvolnění denního limitu. Originál zachován.');continue;}
   await phase(c,'candidate','Approved independent original decode evidence; controlled recovery');await repair(c);return;
  }catch(e){if(c)await phase(c,'manual',e.message);else throw e;}
 }
}
