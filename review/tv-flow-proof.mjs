const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const identity=value=>plain(value)&&Number.isSafeInteger(value.dev)&&value.dev>=0&&Number.isSafeInteger(value.ino)&&value.ino>0&&Number.isFinite(value.ctime);
const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

/** True only for the v2 receipt emitted after strict decode, preservation and staged-copy verification. */
export function validTvStrictProof(receipt){
 const expected=['profile','jobId','sourceIdentity','outputIdentity','preservation','decode','stagedCopy'];
 const proof=receipt?.strictProof;
 return receipt?.version===2&&exact(proof,expected)&&exact(proof.profile,['id','version'])&&
  proof.profile.id==='tv-review-staging-v1-template'&&proof.profile.version===1&&typeof receipt.jobId==='string'&&receipt.jobId.length>0&&proof.jobId===receipt.jobId&&
  identity(proof.sourceIdentity)&&identity(proof.outputIdentity)&&
  proof.preservation==='passed'&&proof.decode==='complete'&&proof.stagedCopy==='verified';
}

export function tvStrictProofMatchesFiles(receipt,sourceStat,resultStat){
 if(!validTvStrictProof(receipt))return false;
 const matches=(record,stat)=>record.dev===stat.dev&&record.ino===stat.ino&&record.ctime===stat.ctimeMs;
 return matches(receipt.strictProof.sourceIdentity,sourceStat)&&matches(receipt.strictProof.outputIdentity,resultStat);
}
