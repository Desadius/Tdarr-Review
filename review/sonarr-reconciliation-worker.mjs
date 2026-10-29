import fs from 'node:fs/promises';
import path from 'node:path';
import {openDirectoryNoFollow} from './core.mjs';

const maxInput=4096,maxOutput=4*1024*1024,maxEntries=10000,maxDirectories=256,maxDepth=16;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fdPath=handle=>`/proc/self/fd/${handle.fd}`;
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&a.nlink===b.nlink;
const fingerprint=stat=>[stat.dev,stat.ino,stat.mode,stat.nlink,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
const validRelative=value=>typeof value==='string'&&value.length>0&&value.length<=2048&&!value.startsWith('/')&&!value.includes('\\')&&!value.includes('\0')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&part.length<=255);
class ScanLimit extends Error{}
class ScanChanged extends Error{}
class ScanUnsafe extends Error{}
class ScanInaccessible extends Error{}
class ScanUnsupported extends Error{}
function classify(error){
 if(error instanceof ScanLimit||error instanceof ScanChanged||error instanceof ScanUnsafe||error instanceof ScanInaccessible||error instanceof ScanUnsupported)return error;
 if(['EACCES','EPERM'].includes(error?.code))return new ScanInaccessible();
 if(['ELOOP'].includes(error?.code)||error?.message==='Kořen trvalé karantény není bezpečný adresář.')return new ScanUnsafe();
 if(['ENOENT','ENOTDIR'].includes(error?.code))return new ScanChanged();
 if(['EINVAL','ENOSYS','ENOTSUP','EOPNOTSUPP'].includes(error?.code))return new ScanUnsupported();
 return error;
}

async function openChildDirectory(parent,name,before){
 if(!name||name==='.'||name==='..'||name.includes('/')||name.includes('\0'))throw new ScanChanged();
 const namedPath=path.join(fdPath(parent),name),flags=fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW;
 const opened=await fs.open(namedPath,flags),after=await opened.stat(),named=await fs.lstat(namedPath);
 if(!after.isDirectory()||named.isSymbolicLink()||!same(after,before)||!same(named,after)){await opened.close();throw new ScanChanged();}
 return opened;
}
async function boundedNames(directory,maximum){
 const listing=await fs.opendir(fdPath(directory)),names=[];
 try{for await(const entry of listing){if(names.length>=maximum)throw new ScanLimit();names.push(entry.name);}}
 finally{await listing.close().catch(()=>{});}
 return names.sort();
}

async function scan(mediaRoot,relative){
 if(process.platform!=='linux')return {status:'unavailable',entries:[]};
 let root;
 const handles=[],directories=[],files=[],entries=[];
 let directoryCount=0,entryCount=0,outputBytes=0;const fileIdentities=new Set();
 try{
  root=await openDirectoryNoFollow(mediaRoot);handles.push(root);
  let anchor=root;const anchorParts=relative.split('/'),anchorChain=[];
  for(const name of anchorParts){
   const namedPath=path.join(fdPath(anchor),name),before=await fs.lstat(namedPath);
   if(before.isSymbolicLink()||!before.isDirectory())throw new ScanUnsafe();
   const next=await openChildDirectory(anchor,name,before);handles.push(next);anchorChain.push({parent:anchor,name,handle:next,stat:await next.stat()});anchor=next;
  }
  const emit=record=>{
   const bytes=Buffer.byteLength(JSON.stringify(record))+1;
   if(outputBytes+bytes>maxOutput)throw new ScanLimit();
   outputBytes+=bytes;entries.push(record);
  };
  async function walk(directory,rel,depth,parent=null,name=null){
   if(Date.now()-started>20000)throw new ScanLimit();
   if(depth>maxDepth||++directoryCount>maxDirectories)throw new ScanLimit();
   const stat=await directory.stat(),record={kind:'directory',relative:rel,size:stat.size,modifiedAt:Math.round(stat.mtimeMs),fingerprint:fingerprint(stat)};
   emit(record);directories.push({relative:rel,parent,name,handle:directory,stat});
   const names=await boundedNames(directory,maxEntries-entryCount);
   for(const child of names){
    if(Date.now()-started>20000)throw new ScanLimit();
    if(++entryCount>maxEntries)throw new ScanLimit();
    if(!child||child==='.'||child==='..'||child.includes('/')||child.includes('\0'))throw new ScanChanged();
    const childRelative=rel?rel+'/'+child:child;if(childRelative.length>2048)throw new ScanLimit();
    const childPath=path.join(fdPath(directory),child);let before;
    before=await fs.lstat(childPath);
    if(before.isSymbolicLink()){emit({kind:'symlink',relative:childRelative,fingerprint:fingerprint(before)});continue;}
    if(before.isDirectory()){
     const nested=await openChildDirectory(directory,child,before);
     handles.push(nested);await walk(nested,childRelative,depth+1,directory,child);continue;
    }
    if(!before.isFile()){emit({kind:'special',relative:childRelative,fingerprint:fingerprint(before)});continue;}
    let file;
    file=await fs.open(childPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    let opened;
    try{opened=await file.stat();}finally{await file.close();}
    const after=await fs.lstat(childPath);
    if(after.isSymbolicLink()||!opened.isFile()||!same(before,opened)||!same(opened,after))throw new ScanChanged();
    const identity=opened.dev+':'+opened.ino;
    const hardlinked=opened.nlink!==1||fileIdentities.has(identity);fileIdentities.add(identity);
    const item={kind:hardlinked?'hardlink':'file',relative:childRelative,size:opened.size,modifiedAt:Math.round(opened.mtimeMs),fingerprint:fingerprint(opened)};
    emit(item);files.push({relative:childRelative,parent:directory,name:child,stat:opened});
   }
   const afterNames=await boundedNames(directory,names.length);
   if(names.length!==afterNames.length||names.some((value,index)=>value!==afterNames[index]))throw new ScanChanged();
   if(parent){const named=await fs.lstat(path.join(fdPath(parent),name));if(named.isSymbolicLink()||!same(named,stat))throw new ScanChanged();}
  }
  const started=Date.now();
  await walk(anchor,'',0,anchorChain.length>1?anchorChain.at(-2).handle:root,anchorParts.at(-1));
  // Reopen the configured root and the selected-series anchor; names must still resolve to the pinned directories.
  const freshRoot=await openDirectoryNoFollow(mediaRoot);handles.push(freshRoot);
  const freshStat=await freshRoot.stat(),rootStat=await root.stat();if(!same(freshStat,rootStat))throw new ScanChanged();
  let current=freshRoot;const freshChain=[];
  for(let i=0;i<anchorParts.length;i++){
   const name=anchorParts[i],expected=anchorChain[i].stat,namedPath=path.join(fdPath(current),name),before=await fs.lstat(namedPath);
   if(before.isSymbolicLink()||!before.isDirectory())throw new ScanChanged();
   const opened=await openChildDirectory(current,name,before);handles.push(opened);freshChain.push(opened);
   if(!same(await opened.stat(),expected))throw new ScanChanged();current=opened;
  }
  // Every walked directory and file is still named beneath its pinned parent with the same metadata identity.
  for(const directory of directories){
   if(!directory.parent)continue;
   const named=await fs.lstat(path.join(fdPath(directory.parent),directory.name));if(named.isSymbolicLink()||!same(named,directory.stat))throw new ScanChanged();
  }
  for(const file of files){const named=await fs.lstat(path.join(fdPath(file.parent),file.name));if(named.isSymbolicLink()||!same(named,file.stat))throw new ScanChanged();}
  return {status:'complete',rootIdentity:fingerprint(await root.stat()),anchorIdentities:anchorChain.map(value=>fingerprint(value.stat)),entries};
 }catch(error){
  const classified=classify(error);
  if(classified instanceof ScanLimit)return {status:'limited',entries};
  if(classified instanceof ScanChanged)return {status:'changed',entries:[]};
  if(classified instanceof ScanUnsafe)return {status:'unsafe',entries:[]};
  if(classified instanceof ScanInaccessible)return {status:'inaccessible',entries:[]};
  if(classified instanceof ScanUnsupported)return {status:'unsupported',entries:[]};
  return {status:'unavailable',entries:[]};
 }finally{for(const handle of handles.reverse())await handle.close().catch(()=>{});}
}

let raw='';for await(const chunk of process.stdin){raw+=chunk;if(Buffer.byteLength(raw)>maxInput)break;}
let input;try{input=JSON.parse(raw);}catch{}
if(!plain(input)||Object.keys(input).some(key=>!['mediaRoot','relative'].includes(key))||typeof input.mediaRoot!=='string'||!path.posix.isAbsolute(input.mediaRoot)||input.mediaRoot==='/'||input.mediaRoot.includes('\\')||input.mediaRoot.includes('\0')||path.posix.normalize(input.mediaRoot)!==input.mediaRoot||!validRelative(input.relative)){
 process.stdout.write(JSON.stringify({status:'unsafe',entries:[]})+'\n');process.exitCode=1;
}else{
 const result=await scan(input.mediaRoot,input.relative),text=JSON.stringify(result);
 if(Buffer.byteLength(text)>maxOutput)process.stdout.write(JSON.stringify({status:'limited',entries:[]})+'\n');
 else process.stdout.write(text+'\n');
}
