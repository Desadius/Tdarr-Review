module.exports=async(args)=>{
 const user=args.variables.user||{};
 if(user.hevcSDR&&!user.hevcSDR.verified)throw Error('HEVC SDR verification missing');
 if(user.legacySDR&&!user.legacySDR.verified)throw Error('Legacy SDR verification missing');
 if(user.dv81&&!user.dv81.verified)throw Error('DV verification missing');
 let review=!!(user.hevcSDR||user.transportSource||user.cropped1080||user.legacySDR||user.languageFallback||user.hdr10||user.dv81||user.extraHDR);
 if(!review){
  const fs=require('fs/promises');
  const source=String(user.reviewSource?.path||'').replace(/\\/g,'/');
  const root=['','media','movies',''].join('/'),at=source.indexOf(root);
  if(at<0||!source.slice(at+root.length)||source.slice(at+root.length).split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Recovery Review routing: source identity missing or unsafe');
  const title=source.slice(at+root.length).split('/')[0];
  const statusFile=source.slice(0,at)+['','media','.tdarr-recovery-status.json'].join('/');
  const stat=await fs.stat(statusFile);
  if(!stat.isFile()||stat.size>1048576)throw Error('Recovery Review routing: unsafe status snapshot');
  const status=JSON.parse(await fs.readFile(statusFile,'utf8'));
  const time=Date.parse(status.updated),age=Date.now()-time;
  if(status.version!==1||!Array.isArray(status.cases)||!Number.isFinite(time)||age>12*60000||age< -120000)throw Error('Recovery Review routing: status unavailable or stale; original preserved');
  // Conservative movie-level routing also protects historical cases without a
  // replacement filename. This never supplies approval or cleanup authority.
  const cases=status.cases.filter(c=>c.source==='recovery'&&c.phase==='replacement_imported'&&c.title===title);
  review=cases.length>0;
  if(review)args.jobLog('Recovery replacement requires Review approval; original will be preserved.');
 }
 return {outputFileObj:args.inputFileObj,outputNumber:review?2:1,variables:args.variables};
};
