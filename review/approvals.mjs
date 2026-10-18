// Approval without replacement: an explicit, durable decision bound to the exact item snapshot and the
// saved review revision. It never touches media. A later replacement re-validates it; a changed snapshot
// or a newer review revision makes it stale, so it never authorizes a different result.

/** @param {any} state @param {{id:string,snapshot:string,reviewRevision:number,now?:Date}} decision */
export function recordApproval(state,{id,snapshot,reviewRevision,now=new Date()}){
 if(!state.approvals||typeof state.approvals!=='object'||Array.isArray(state.approvals))state.approvals={};
 return state.approvals[id]={snapshot,reviewRevision,approvedAt:now.toISOString()};
}
/** The stored approval when it still matches the item's snapshot and the given review revision. */
export function currentApproval(state,item,reviewRevision){
 const a=state.approvals?.[item?.id];
 return a&&typeof a==='object'&&a.snapshot===item.snapshot&&Number.isSafeInteger(a.reviewRevision)&&a.reviewRevision===reviewRevision?a:null;
}
export function forgetApproval(state,id){if(state.approvals&&typeof state.approvals==='object')delete state.approvals[id]}
/** Approvals still valid for the listed items and their current saved review, for the overview. */
export function publicApprovals(state,items,sessions){
 return Object.fromEntries(items.flatMap(item=>{const a=currentApproval(state,item,sessions[item.id]?.revision);return a&&sessions[item.id]?.complete===true?[[item.id,{approvedAt:a.approvedAt,reviewRevision:a.reviewRevision}]]:[]}));
}
