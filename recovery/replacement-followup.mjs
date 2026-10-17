import {identity} from './policy.mjs';
import {compareIdentity} from './file-identity.mjs';

// Display linkage only. It grants no authority and never changes either case.
// It also keeps its stricter rule: only non-negative plain decimal fields.
function matchFingerprint(stored,current){
 if(![stored,current].every(v=>typeof v==='string'&&v.split(':').every(x=>/^\d+(?:\.\d+)?$/.test(x))))return null;
 const change=compareIdentity(stored,current);
 return change==='same'?'exact':change==='ctime-changed'?'ctime_changed':null;
}
export function replacementFollowup(parent,{cfg,state}){
 if(parent.status!=='replacement_imported'||parent.cleanup?.approvedAt||parent.cleanup?.complete||!parent.replacementSourceFP||!parent.replacementRelative||!Number.isInteger(parent.movieId)||parent.movieId<=0||!Number.isInteger(parent.replacement?.movieFileId)||parent.replacement.movieFileId<=0||!Number.isSafeInteger(parent.replacement?.size)||parent.replacement.size<=0)return null;
 const file=cfg.sourceRoot+'/'+parent.replacementRelative;
 const matches=Object.values(state.cases||{}).filter(c=>c.id!==parent.id&&typeof c.fp==='string'&&c.id===identity(file,c.fp)&&c.movieId===parent.movieId&&c.file===file&&c.relative===parent.replacementRelative&&matchFingerprint(parent.replacementSourceFP,c.fp)&&c.size===parent.replacement.size&&c.binding?.movieFileId===parent.replacement.movieFileId);
 return matches.length===1?{id:matches[0].id,binding:matchFingerprint(parent.replacementSourceFP,matches[0].fp)}:null;
}
export const replacementFollowupId=(parent,deps)=>replacementFollowup(parent,deps)?.id||null;

// Called after sanitizing the public snapshot, so nested details cannot expose
// paths, credentials or private evidence. Never copy another nested follow-up.
export function projectReplacementFollowups(snapshot){
 const cases=snapshot.cases||[];
 return {...snapshot,cases:cases.map(c=>{
  const id=c.replacementFollowupId;
  const matches=cases.filter(x=>x.id===id&&x.id!==c.id&&x.source==='recovery');
  if(typeof id!=='string'||!/^[a-f0-9]{24}$/.test(id)||matches.length!==1)return c;
  const child=matches[0];
  const fields=['verifyPausedStep','originalOutsideLibrary','originalOutsideSince','originalRestoredAt','id','source','phase','statusUpdated','originalCheckKind','sourceRetained','nextRetryAt','nextSearchAt','tdarrStatus','progress'];
  return {...c,replacementFollowup:{...Object.fromEntries(fields.filter(k=>Object.hasOwn(child,k)).map(k=>[k,child[k]])),hasError:!!child.error}};
 })};
}
