// Pure matching policy; file identity and approval checks remain with the caller.
export class ReviewJobMatchError extends Error {
  constructor(code,message){super(message);this.name='ReviewJobMatchError';this.code=code;}
}
const fail=(code,message)=>{throw new ReviewJobMatchError(code,message)};
const normalized=p=>String(p||'').replaceAll('\\','/');
function jobBytes(gib){
  return typeof gib==='number'&&Number.isFinite(gib)&&gib>=0?Math.round(gib*2**30):null;
}
export function matchReviewJob(jobs,{receipt=null,receiptVersions=[1],libraryId='',sourceRoots,relative,sourceBytes,outputBytes}){
  if(!Array.isArray(jobs))fail('INVALID_JOBS','Tdarr vrátil neplatný seznam úloh.');
  if(!Array.isArray(sourceRoots)||!sourceRoots.length||sourceRoots.some(r=>typeof r!=='string'||!r))fail('INVALID_ROOTS','Chybí zdrojové cesty pro přiřazení úlohy.');
  if(typeof relative!=='string'||relative.replaceAll('\\','/').split('/').some(x=>!x||x==='.'||x==='..'))fail('INVALID_PATH','Neplatná relativní cesta filmu.');
  if(!Number.isSafeInteger(sourceBytes)||sourceBytes<=0||!Number.isSafeInteger(outputBytes)||outputBytes<=0)fail('INVALID_SIZES','Neplatná velikost originálu nebo výsledku.');
  if(typeof libraryId!=='string')fail('INVALID_LIBRARY','Neplatná knihovna Tdarr.');
  let exactJobId=null;
  if(receipt!==null&&receipt!==undefined){
    if(typeof receipt!=='object'||Array.isArray(receipt)||!Array.isArray(receiptVersions)||!receiptVersions.includes(receipt.version)||receipt.relative!==relative)fail('INVALID_RECEIPT','Záznam převodu neodpovídá tomuto originálu.');
    if(Object.hasOwn(receipt,'jobId')){
      if(typeof receipt.jobId!=='string'||!receipt.jobId.trim()||receipt.jobId!==receipt.jobId.trim())fail('INVALID_JOB_ID','Záznam převodu má neplatné ID úlohy Tdarr.');
      exactJobId=receipt.jobId;
    }
  }
  const allowedPaths=new Set(sourceRoots.map(root=>normalized(root).replace(/\/+$/,'')+'/'+normalized(relative)));
  const candidates=jobs.filter(j=>j&&typeof j==='object'&&j.status==='Transcode success'
    &&(!libraryId||j.DB===libraryId)&&allowedPaths.has(normalized(j.file))
    &&jobBytes(j.fileSizeStartGB)===sourceBytes&&jobBytes(j.fileSizeEndGB)===outputBytes);
  if(exactJobId!==null){
    const exact=candidates.filter(j=>j._id===exactJobId);
    if(exact.length!==1)fail('EXACT_JOB_MISSING','Záznam převodu nemá odpovídající úspěšnou úlohu Tdarr se stejným ID, knihovnou, cestou a velikostmi.');
    return exact[0];
  }
  // Older receipts do not have a job ID; refuse ambiguous historical evidence.
  if(candidates.length!==1){
    if(candidates.length>1)fail('LEGACY_AMBIGUOUS','Starší výsledek odpovídá více úlohám Tdarr. Jednoznačné přiřazení vyžaduje kontrolu.');
    fail('LEGACY_JOB_MISSING','Chybí odpovídající úspěšná úloha Tdarr nebo se originál změnil.');
  }
  return candidates[0];
}
