import fs from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import path from 'node:path';

const tvFields=Object.freeze({
 enabled:'boolean',mediaRoot:'container',reviewRoot:'container',libraryId:'text',
 sourceRoots:'namespaces',tdarrReviewRoot:'namespace',reviewPrefixes:'prefixes',
 sonarrRoot:'namespace',quarantineRoot:'container',reports:'container'
});
const error=(code,field)=>Object.assign(new Error(code==='settings_invalid'?'Invalid TV library settings':'TV processing is unavailable'),{
 code,...(field?{field}:{}),...(code==='settings_invalid'?{status:400}:{})
});
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hasTraversal=value=>value.includes('\0')||value.split('/').some(part=>part==='.'||part==='..');

function containerPath(value){
 if(value==='')return '';
 if(typeof value!=='string'||value.length>2048||!value.startsWith('/')||value==='/'||value.includes('\\')||value.includes('\0'))return null;
 if(value.endsWith('/')||path.posix.normalize(value)!==value)return null;
 return value;
}

function namespacePath(value){
 if(typeof value!=='string'||value.length===0||value.length>2048||value.includes('\0'))return null;
 let normalized=value.replaceAll('\\','/');
 const drive=/^[A-Za-z]:\//.test(normalized);
 const unc=normalized.startsWith('//')&&!normalized.startsWith('///');
 const linux=normalized.startsWith('/')&&!normalized.startsWith('//');
 if(!drive&&!unc&&!linux)return null;
 if(hasTraversal(normalized))return null;
 if(drive){const driveLetter=normalized[0].toUpperCase(),tail=path.posix.normalize('/'+normalized.slice(3)).replace(/\/+$/,'');if(!tail)return null;return driveLetter+':'+tail;}
 if(unc){const parts=normalized.slice(2).split('/').filter(Boolean);if(parts.length<2)return null;return '//'+parts.join('/');}
 const normal=path.posix.normalize(normalized),clean=normal==='/'?'/':normal.replace(/\/+$/,'');
 return clean==='/'?null:clean;
}

function prefix(value){
 return typeof value==='string'&&value.length>0&&value.length<=1024&&!value.includes('\0')&&!value.includes('/')&&!value.includes('\\')&&value!=='.'&&value!=='..';
}

function validateTv(value){
 if(!isObject(value))throw error('settings_invalid','libraries.tv');
 if(value.enabled===true)throw error('settings_tv_processing_unavailable');
 if(Object.keys(value).some(key=>!Object.hasOwn(tvFields,key)))throw error('settings_invalid','libraries.tv');
 const normalized={...emptyTvLibrary()};
 for(const [key,type] of Object.entries(tvFields)){
  if(!Object.hasOwn(value,key))continue;
  const item=value[key];
  if(type==='boolean'){
   if(typeof item!=='boolean')throw error('settings_invalid','libraries.tv');
   normalized[key]=item;
  }else if(type==='text'){
   if(typeof item!=='string'||item.length>2048||item.includes('\0'))throw error('settings_invalid','libraries.tv');
   normalized[key]=item;
  }else if(type==='container'){
   if(typeof item!=='string'||item.length>2048)throw error('settings_invalid','libraries.tv');
   const clean=containerPath(item);
   if(clean===null)throw error('settings_invalid','libraries.tv');
   normalized[key]=clean;
  }else if(type==='namespace'){
   if(item===''){normalized[key]='';continue;}
   const clean=namespacePath(item);
   if(clean===null)throw error('settings_invalid','libraries.tv');
   normalized[key]=clean;
  }else if(type==='namespaces'){
   if(!Array.isArray(item)||item.length>20)throw error('settings_invalid','libraries.tv');
   normalized[key]=item.map(entry=>{
    if(entry==='')throw error('settings_invalid','libraries.tv');
    const clean=namespacePath(entry);
    if(clean===null)throw error('settings_invalid','libraries.tv');
    return clean;
   });
  }else if(type==='prefixes'){
   if(!Array.isArray(item)||item.length>20||item.some(entry=>!prefix(entry)))throw error('settings_invalid','libraries.tv');
   normalized[key]=[...item];
  }
 }
 return normalized;
}

export function emptyTvLibrary(){
 return {enabled:false,mediaRoot:'',reviewRoot:'',libraryId:'',sourceRoots:[],tdarrReviewRoot:'',reviewPrefixes:[],sonarrRoot:'',quarantineRoot:'',reports:''};
}

/** Validate and clone the optional per-library TV mapping without activating processing. */
export function validateLibraryPlans(libraries){
 if(libraries===undefined)return undefined;
 if(libraries===null)return libraries;
 if(!isObject(libraries)||Object.keys(libraries).some(key=>key!=='tv'))throw error('settings_invalid','libraries.tv');
 const result={...libraries};
 if(Object.hasOwn(libraries,'tv')&&libraries.tv!==null)result.tv=validateTv(libraries.tv);
 return result;
}

function unescapeMountField(value){return value.replace(/\\([0-7]{3})/g,(_,octal)=>String.fromCharCode(parseInt(octal,8)));}
function parseMountInfo(text){
 if(typeof text!=='string')return [];
 const mounts=[];
 for(const line of text.split('\n')){
  const fields=line.trim().split(/\s+/),separator=fields.indexOf('-');
  if(separator<6||fields.length<separator+4||!/^\d+$/.test(fields[0])||!/^\d+:\d+$/.test(fields[2]))continue;
  mounts.push({id:fields[0],device:fields[2],root:unescapeMountField(fields[3]),point:unescapeMountField(fields[4])});
 }
 return mounts;
}
function mountFor(file,mounts){
 let selected=null;
 for(const mount of mounts){
  const point=path.posix.normalize(mount.point);
  if(file===point||file.startsWith(point==='/'?'/':point+'/'))if(!selected||point.length>selected.point.length)selected={...mount,point};
 }
 return selected;
}
function within(parent,child){return parent===child||child.startsWith(parent.endsWith('/')?parent:parent+'/');}
function physicalPath(file,mount){
 if(!mount)return null;
 const suffix=file===mount.point?'':file.slice(mount.point==='/'?1:mount.point.length+1);
 return path.posix.normalize(path.posix.join(mount.root,suffix));
}
function overlap(a,b){return a&&b&&(within(a,b)||within(b,a));}
function normalizedContainer(value){
 if(typeof value!=='string'||value==='')return null;
 const clean=containerPath(value);return clean===null?null:clean;
}
function issue(code,roles){return {code,roles:[...new Set(roles)]};}

async function inspectPath(entry,fsApi){
 const {path:configured,kind}=entry;
 const base={role:entry.role,path:typeof configured==='string'?configured:'',status:'not_configured',readable:false,writable:false,required:entry.required};
 if(!base.path)return base;
 const clean=normalizedContainer(base.path);
 if(!clean){base.status='unsafe_path';return base;}
 if(process.platform!=='linux'){base.status='unavailable';return base;}
 const parts=clean.split('/').filter(Boolean),components=['/',...parts.map((_,index)=>'/'+parts.slice(0,index+1).join('/'))];
 let final;
 try{
  for(let index=0;index<components.length;index++){
   const component=components[index],stat=await fsApi.lstat(component);
   if(stat.isSymbolicLink()){base.status='unsafe_path';return base;}
   const isLast=index===components.length-1;
   if(!isLast&&!stat.isDirectory()){base.status='not_directory';return base;}
   if(isLast)final=stat;
  }
 }catch(cause){
  if(cause?.code==='ENOENT'||cause?.code==='ENOTDIR'){base.status='missing_or_unmounted';return base;}
  if(cause?.code==='EACCES'||cause?.code==='EPERM'){base.status='unreadable';return base;}
  base.status='unavailable';return base;
 }
 if(kind==='directory'&&!final?.isDirectory()){base.status='not_directory';return base;}
 if(kind==='file'&&!final?.isFile()){base.status='not_file';return base;}
 const readableMode=kind==='directory'?fsConstants.R_OK|fsConstants.X_OK:fsConstants.R_OK;
 const writableMode=kind==='directory'?fsConstants.W_OK|fsConstants.X_OK:fsConstants.W_OK;
 try{await fsApi.access(clean,readableMode);base.readable=true;}catch(cause){base.status=['EACCES','EPERM'].includes(cause?.code)?'unreadable':'unavailable';return base;}
 try{await fsApi.access(clean,writableMode);base.writable=true;}catch(cause){
  if(!['EACCES','EPERM','EROFS'].includes(cause?.code)){base.status='unavailable';return base;}
  base.writable=false;
 }
 base.status=base.writable||!entry.requiresWrite?'ready':'not_writable';
 return base;
}

function movieDescriptor(candidate,data){
 const review=isObject(candidate?.review)?candidate.review:{};
 const radarr=isObject(candidate?.radarr)?candidate.radarr:{};
 const recovery=isObject(candidate?.recovery)?candidate.recovery:{};
 return {id:'movies',enabled:true,resultPrefixes:Array.isArray(review.reviewPrefixes)?review.reviewPrefixes.filter(prefix):[],namespace:[...(Array.isArray(review.sourceRoots)?review.sourceRoots:[]),review.tdarrReviewRoot].filter(value=>typeof value==='string'&&value),entries:[
  {role:'source',path:review.mediaRoot,kind:'directory',required:true,requiresWrite:true},
  {role:'result',path:review.reviewRoot,kind:'directory',required:true,requiresWrite:true},
  {role:'quarantine',path:radarr.quarantineRoot,kind:'directory',required:true,requiresWrite:true},
  {role:'reports',path:recovery.reports,kind:'directory',required:recovery.enabled===true,requiresWrite:false},
  {role:'database',path:review.database,kind:'file',required:true,requiresWrite:false},
  {role:'data',path:data,kind:'directory',required:true,requiresWrite:true}
 ]};
}
function tvDescriptor(candidate){
 let planValue;try{planValue=validateLibraryPlans(candidate?.libraries).tv;}catch{planValue=null;}
 if(!planValue||!isObject(planValue))planValue=emptyTvLibrary();
 return {id:'tv',enabled:false,resultPrefixes:planValue.reviewPrefixes,namespace:[...planValue.sourceRoots,planValue.tdarrReviewRoot,planValue.sonarrRoot].filter(Boolean),entries:[
  {role:'source',path:planValue.mediaRoot,kind:'directory',required:!!planValue.mediaRoot,requiresWrite:false},
  {role:'result',path:planValue.reviewRoot,kind:'directory',required:!!planValue.reviewRoot,requiresWrite:true},
  {role:'quarantine',path:planValue.quarantineRoot,kind:'directory',required:!!planValue.quarantineRoot,requiresWrite:true},
  {role:'reports',path:planValue.reports,kind:'directory',required:!!planValue.reports,requiresWrite:false}
 ]};
}

/** Read-only filesystem diagnostics. Values are deliberately reduced to status codes. */
export async function diagnoseLibraryPaths(candidate,{data,readMountInfo,fsApi=fs}={}){
 let mountText='';
 try{mountText=readMountInfo?await readMountInfo():process.platform==='linux'?await fs.readFile('/proc/self/mountinfo','utf8'):'';}catch{}
 const mounts=parseMountInfo(mountText);
 const descriptors=[movieDescriptor(candidate,data),tvDescriptor(candidate)];
 const libraries=await Promise.all(descriptors.map(async descriptor=>{
  const entries=descriptor.entries.flatMap(entry=>entry.role==='result'&&entry.path&&descriptor.resultPrefixes.length
   ?descriptor.resultPrefixes.map(value=>({...entry,path:path.posix.join(entry.path,value)}))
   :[entry]);
  const paths=await Promise.all(entries.map(entry=>inspectPath(entry,fsApi)));
  const issues=[];
  if(descriptor.namespace.length)issues.push(issue('namespace_unverified',['source','result']));
 return {id:descriptor.id,enabled:descriptor.enabled,paths,issues,ok:paths.filter(entry=>entry.required).every(entry=>entry.status==='ready')};
 }));

 // Namespace paths stay informational because there is no implicit Tdarr-to-Review
 // identity mapping. Protected writable roots cannot overlap any library source/result.
 const roots=[];
 for(const library of libraries)for(const role of ['source','result','quarantine','reports','data']){
  if(role==='data'&&library.id!=='movies')continue;
  for(const item of library.paths.filter(entry=>entry.role===role)){
   const clean=normalizedContainer(item.path);
   if(!clean||item.status==='unsafe_path')continue;
   let real=null,stat=null;
   try{real=await fsApi.realpath(clean);stat=await fsApi.stat(clean);}catch{}
   const mount=mountFor(clean,mounts);
   roots.push({library,role,path:clean,real:typeof real==='string'?real:null,stat,mount,physical:physicalPath(clean,mount)});
  }
 }
 for(let left=0;left<roots.length;left++)for(let right=left+1;right<roots.length;right++){
  const a=roots[left],b=roots[right];
  if(a.library===b.library&&a.role===b.role)continue;
  const mediaRole=root=>root.role==='source'||root.role==='result';
  const protectedRole=root=>root.role==='quarantine'||root.role==='reports'||root.role==='data';
  if(!(mediaRole(a)&&mediaRole(b))&&!(protectedRole(a)&&mediaRole(b))&&!(mediaRole(a)&&protectedRole(b)))continue;
  let collides=overlap(a.path,b.path)||overlap(a.real,b.real);
  if(!collides&&a.mount?.device&&a.mount.device===b.mount?.device)collides=overlap(a.physical,b.physical);
  if(!collides&&a.stat&&b.stat&&a.stat.dev===b.stat.dev&&a.stat.ino===b.stat.ino)collides=true;
  if(collides){
   a.library.issues.push(issue('overlap',[a.role,b.role]));
   if(a.library!==b.library)b.library.issues.push(issue('overlap',[a.role,b.role]));
  }
 }

 for(const library of libraries){
  const source=library.paths.find(entry=>entry.role==='source');
  const quarantine=library.paths.find(entry=>entry.role==='quarantine');
  if(source?.status==='ready'&&quarantine?.status==='ready'){
   const sourcePath=normalizedContainer(source.path),quarantinePath=normalizedContainer(quarantine.path);
   const sourceMount=mountFor(sourcePath,mounts),quarantineMount=mountFor(quarantinePath,mounts);
   if(sourceMount&&quarantineMount&&sourceMount.id!==quarantineMount.id){
    library.issues.push(issue('quarantine_mount_incompatible',['source','quarantine']));
   }else if(!sourceMount||!quarantineMount){
    const roles=['source','quarantine'];
    if(!library.issues.some(value=>value.code==='namespace_unverified'))library.issues.push(issue('namespace_unverified',roles));
   }
  }
  library.issues=library.issues.filter((value,index,values)=>values.findIndex(item=>item.code===value.code&&item.roles.join('\0')===value.roles.join('\0'))===index);
  library.ok=library.ok&&!library.issues.some(value=>value.code==='overlap'||value.code==='quarantine_mount_incompatible');
 }
 return {readOnly:true,processingEnabled:false,libraries};
}
