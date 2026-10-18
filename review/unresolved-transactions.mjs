import path from 'node:path';

// What Review may show about an exchange transaction that needs manual inspection.
// No media paths and no journal contents: error texts are reduced to known reason codes,
// because a filesystem error message can contain a path.
const PHASES=new Set(['preparing','syncing-copy','verifying-copy','ready','original-backed-up','original-removed','installed']);
const REASONS={'Neplatná identita souboru v záznamu výměny.':'invalid-identity','Neplatné cesty v záznamu výměny.':'invalid-paths'};
const name=value=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,80}$/.test(value)?value:null;

/** @param {any[]} pending @param {{id:string,title:string,relative:string}[]} items @param {string} mediaRoot */
export function unresolvedTransactions(pending,items,mediaRoot){
 return (Array.isArray(pending)?pending:[]).map(t=>{
  const item=typeof t?.original==='string'?items.find(x=>typeof x?.relative==='string'&&path.join(mediaRoot,x.relative)===t.original):null;
  return {
   id:name(t?.id),
   journal:typeof t?.journal==='string'?name(path.basename(t.journal)):null,
   phase:PHASES.has(t?.phase)?t.phase:'unknown',
   reason:t?.error?REASONS[t.error]||'unreadable':'needs-inspection',
   title:item?.title??null,
   itemId:item?.id??null,
  };
 });
}
