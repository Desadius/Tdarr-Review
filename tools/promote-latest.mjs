import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// Moves `latest` to an image that is already published, identified by the digest the maintainer
// verified (docs/RELEASES.md). Nothing is built and no other tag is written. The sha-<commit> tag
// is never trusted, because a repeated publication moves it: the image itself must carry the
// approved commit in its revision label (set from VCS_REF in the Dockerfile).
export class PromotionRefusal extends Error{}
const REVISION='org.opencontainers.image.revision';
const refuse=message=>{throw new PromotionRefusal(message);};

async function inspect(docker,ref,field){
 return JSON.parse(await docker(['buildx','imagetools','inspect',ref,'--format','{{json .'+field+'}}']));
}
// The image config of a single manifest, or of the linux/amd64 entry of an index.
const missing=error=>/\bnot found\b/i.test(error?.message||'');
const amd64=image=>image&&Object.hasOwn(image,'config')?image:image?.['linux/amd64'];

export async function promoteLatest({image,commit,digest,docker}){
 if(typeof image!=='string'||!/^[a-z0-9.-]+(?::\d+)?(?:\/[a-z0-9._-]+)+$/.test(image))refuse('Expected an image name without tag or digest');
 if(typeof commit!=='string'||!/^[0-9a-f]{40}$/.test(commit))refuse('Expected a full lowercase commit SHA');
 if(typeof digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(digest))refuse('Expected a digest sha256:<64 lowercase hex characters>');
 const source=image+'@'+digest;
 let manifest,config;
 try{manifest=await inspect(docker,source,'Manifest');config=amd64(await inspect(docker,source,'Image'));}
 catch(e){refuse((missing(e)?'Image '+source+' was not found in the registry':'Image '+source+' could not be inspected')+': '+e.message);}
 if(manifest?.digest!==digest)refuse('The registry returned a different digest for '+source);
 const revision=config?.config?.Labels?.[REVISION];
 if(revision!==commit)refuse('The image revision label '+REVISION+' is '+(typeof revision==='string'?revision:'missing')+', not the approved commit');
 // Only a missing latest (the first promotion) reads as none; any other lookup failure stops.
 const latest=async()=>{try{return (await inspect(docker,image+':latest','Manifest'))?.digest??null;}catch(e){if(missing(e))return null;throw new PromotionRefusal('latest could not be read: '+e.message);}};
 const before=await latest();
 // A carbon copy: without --prefer-index=false a single manifest would be wrapped in a new index
 // with another digest, and latest would no longer be the image that was verified.
 if(before!==digest)await docker(['buildx','imagetools','create','--prefer-index=false','--tag',image+':latest',source]);
 const after=await latest();
 if(after!==digest)refuse('latest resolves to '+(after||'nothing')+' after the promotion, not '+digest);
 return {before,after};
}

function run(args){
 return new Promise((resolve,reject)=>{
  const child=spawn('docker',args,{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>{stderr+=b;process.stderr.write(b);});
  child.on('error',reject);child.on('close',code=>code===0?resolve(stdout):reject(Error('docker '+args.slice(0,3).join(' ')+' exited with '+code+': '+(stderr.trim().split('\n').at(-1)||'no output'))));
 });
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const {IMAGE:image,COMMIT:commit,DIGEST:digest,GITHUB_STEP_SUMMARY:summary}=process.env;
 try{
  const {before,after}=await promoteLatest({image,commit,digest,docker:run});
  const line='Moved `'+image+':latest` from `'+(before||'none')+'` to `'+after+'` (revision `'+commit+'`); no image was built and no other tag changed.';
  console.log(line);if(summary)await fs.appendFile(summary,line+'\n');
 }catch(e){console.error(e instanceof PromotionRefusal?'Refused: '+e.message:e.message);process.exitCode=1;}
}
