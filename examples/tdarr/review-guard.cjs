// Tdarr Custom Function body. Configure the path/URL/library constants before use.
module.exports=async(args)=>{
 const fs=require('fs/promises'),crypto=require('crypto');
 const mode="guard";
 const norm=p=>String(p).replace(/\\/g,'/');
 const original=mode==='guard'?args.inputFileObj._id:args.variables.user?.reviewSource?.path;
 if(!original)throw Error('Review guard source identity missing');
 const key='/media/movies/',n=norm(original),at=n.indexOf(key);
 if(at<0)throw Error('Review guard: source outside production media');
 const relative=n.slice(at+key.length);if(relative.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Invalid relative path');
 const outputRelative=relative.replace(/\.(m2ts|ts)$/i,'.mkv');
 if(mode==='guard'&&outputRelative!==relative){const destination=original.replace(/\.(m2ts|ts)$/i,'.mkv');try{await fs.lstat(destination);throw Error('REVIEW COLLISION: destination MKV already exists')}catch(e){if(e.code!=='ENOENT')throw e}}
 const target=(process.platform==='win32'?'//UNRAID/tdarr-review-output/PROD-Movies/':'/pilot-review/PROD-Movies/')+outputRelative;
 const receipt=target+'.tdarr-receipt.json';
 async function identity(file){const s=await fs.stat(file);if(!s.isFile())throw Error('Not a regular media file');const h=await fs.open(file,'r');try{const len=Math.min(s.size,1048576),b=Buffer.alloc(len),hash=crypto.createHash('sha256');for(const offset of [0,Math.max(0,s.size-len)]){const {bytesRead}=await h.read(b,0,len,offset);if(bytesRead!==len)throw Error('Short identity read');hash.update(b);}const after=await fs.stat(file);if(after.size!==s.size||after.mtimeMs!==s.mtimeMs)throw Error('File changed during identity check');return {size:s.size,mtime:Math.round(s.mtimeMs),sample:hash.digest('hex')};}finally{await h.close()}}
 const same=(a,b)=>a&&b&&a.size===b.size&&a.mtime===b.mtime&&a.sample===b.sample;
 const source=await identity(original);
 args.variables.user=args.variables.user||{};
 if(mode==='record'){
  if(!same(source,args.variables.user.reviewSource.identity))throw Error('Original changed during transcode');
  const output=await identity(target);
  const jobId=args.job?.jobId;if(typeof jobId!=='string'||!jobId.trim())throw Error('Review receipt: missing Tdarr job ID');
  const data={version:1,relative,outputRelative,source,output,jobId,createdAt:Date.now()};const tmp=receipt+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(data),{flag:'wx'});await fs.rename(tmp,receipt);
  args.jobLog('Review receipt saved: source and output identity');
  return {outputFileObj:args.inputFileObj,outputNumber:1,variables:args.variables};
 }
 args.variables.user.reviewSource={path:original,identity:source};
 try{await fs.stat(target)}catch(e){if(e.code==='ENOENT')return {outputFileObj:args.inputFileObj,outputNumber:1,variables:args.variables};throw e}
 let stored;try{stored=JSON.parse(await fs.readFile(receipt,'utf8'))}catch{throw Error('REVIEW PENDING: existing result has no verified receipt. Resolve it in Review before re-encoding.');}
 const output=await identity(target);
 if(stored.version!==1||stored.relative!==relative||!same(stored.source,source)||!same(stored.output,output))throw Error('REVIEW CHANGED: source or result changed. Resolve old Review result before re-encoding.');
 const r=await fetch('http://YOUR_UNRAID_IP:8266/api/v2/cruddb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:{collection:'JobsJSONDB',mode:'getAll'}}),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Unable to verify previous Tdarr success');const jobs=await r.json();if(!Array.isArray(jobs))throw Error('Invalid job history response');
 // Keep DB paths separate: mapped nodes translate path literals in plugin inputs.
 const serverKey=['','media','movies',''].join('/');
 const matched=jobs.some(j=>j.DB==='YOUR_TDARR_LIBRARY_ID'&&norm(j.file)===serverKey+relative&&j.status==='Transcode success'&&Math.round(j.fileSizeStartGB*2**30)===source.size&&Math.round(j.fileSizeEndGB*2**30)===output.size&&(stored.jobId?j._id===stored.jobId:j.end>=stored.createdAt-5000&&j.start<=stored.createdAt));
 if(!matched){args.jobLog('Review verification failed: '+JSON.stringify({jobId:stored.jobId||null,relative,sourceSize:source.size,outputSize:output.size,createdAt:stored.createdAt,candidates:jobs.filter(j=>norm(j.file)===serverKey+relative).map(j=>({id:j._id,status:j.status,start:j.start,end:j.end,sourceSize:Math.round(j.fileSizeStartGB*2**30),outputSize:Math.round(j.fileSizeEndGB*2**30)}))}));throw Error('REVIEW UNVERIFIED: no matching successful job; result was not treated as complete.');}
 args.jobLog('Skipped: verified successful result already awaiting Review. Original and result unchanged.');
 return {outputFileObj:args.inputFileObj,outputNumber:2,variables:args.variables};
};
