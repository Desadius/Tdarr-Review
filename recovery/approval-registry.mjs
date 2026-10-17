import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {validatePending} from './pending-approved.mjs';
import {identity,relative} from './policy.mjs';
import {canonical,sameValue,frozenConfigDifference} from './frozen-config.mjs';
import {text,relativePrefix} from './config-values.mjs';
import {identityOf} from './file-identity.mjs';

const NAME='pending-approvals.json',MAX_BYTES=2*1024*1024;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
function fail(reason){throw Object.assign(Error('Recovery approval registry: '+reason),{code:'RECOVERY_APPROVAL_REGISTRY'});}
const equal=sameValue;
function freeze(value){if(object(value)||Array.isArray(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const normalized=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);

async function directory(data){
 if(!text(data)||!path.isAbsolute(data))fail('data directory must be absolute');
 const absolute=path.resolve(data),s=await fs.lstat(absolute);
 if(!s.isDirectory()||s.isSymbolicLink()||normalized(await fs.realpath(absolute))!==normalized(absolute))fail('data directory must not contain symlinks');
 return absolute;
}
async function readPrivate(file){
 let h;
 try{
  const l=await fs.lstat(file);
  if(!l.isFile()||l.isSymbolicLink()||l.nlink!==1||normalized(await fs.realpath(file))!==normalized(file))fail('evidence must be a regular unlinked file without symlinks');
  if(l.size<=0||l.size>MAX_BYTES)fail('evidence file size is outside the supported limit');
  if(process.platform!=='win32'&&(l.mode&0o022))fail('evidence must not be writable by group or others');
  h=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  const before=await h.stat();
  if(!before.isFile()||before.nlink!==1||identityOf(before)!==identityOf(l))fail('evidence changed while opening');
  const buffer=Buffer.alloc(MAX_BYTES+1);let length=0;
  while(length<buffer.length){const {bytesRead}=await h.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
  if(length>MAX_BYTES)fail('evidence file size is outside the supported limit');
  const bytes=buffer.subarray(0,length),after=await h.stat();
  if(bytes.length!==before.size||identityOf(before)!==identityOf(after))fail('evidence changed while reading');
  return {bytes,stamp:identityOf(after)};
 }finally{await h?.close();}
}
function parse(bytes){try{return JSON.parse(bytes.toString('utf8'));}catch{fail('invalid JSON');}}
function absolutePOSIX(p){return text(p)&&p.startsWith('/')&&!p.startsWith('//')&&!p.includes('\\')&&p!=='/'&&path.posix.normalize(p)===p&&!p.endsWith('/');}
function validateFrozenIdentity(a,cfg,id){
 if(!object(a)||!text(id)||!/^[0-9a-f]{24}$/.test(id))fail('invalid case identity');
 if(!['movieId','movieFileId','importId','grabId','size'].every(k=>positive(a[k])))fail('incomplete frozen movie/import identity');
 if(!text(a.authorization)||!text(a.sourceTitle)||!text(a.downloadId)||!text(a.fp)||!absolutePOSIX(a.file)||!text(a.relative))fail('incomplete frozen authorization or source');
 let rel;try{rel=relative(a.file,cfg.sourceRoot);}catch{fail('source is outside the frozen library');}
 if(a.relative!==rel||identity(a.file,a.fp)!==id)fail('frozen source identity does not match');
 const parts=a.fp.split(':').map(Number);
 if(parts.length!==5||a.fp.split(':').some(x=>!/^\d+(?:\.\d+)?$/.test(x))||parts.some(x=>!Number.isFinite(x)||x<0)||parts[2]!==a.size)fail('invalid frozen filesystem fingerprint');
}
function validateCase(a,cfg){
 validateFrozenIdentity(a,cfg,a?.id);
 if(!Array.isArray(a.checks)||a.checks.length!==2)fail('two frozen decode checks are required');
 for(const c of a.checks){
  if(!object(c)||!text(c.version)||c.file!==a.file||c.bytes!==a.size||c.sourceUnchanged!==true||c.hostIdentityUnchanged!==true||c.timeout!==false||c.signal||c.error||c.completed===false||c.naturalCompletion===false||!Array.isArray(c.decodeMarkers)||!c.decodeMarkers.every(text)||(c.stderrTail!==undefined&&typeof c.stderrTail!=='string'))fail('ineligible frozen decode evidence');
 }
 try{validatePending(a);}catch{fail('ineligible frozen decode evidence');}
}
function validateMappings(registry,cfg){
 for(const k of ['libraryId','sourceRoot','mediaRoot','radarrRoot','quarantineRoot','reviewRoot','reviewPrefixes'])if(!Object.hasOwn(registry.config,k)||!equal(cfg[k],registry.config[k]))fail('missing frozen library mapping');
 if(!text(cfg.libraryId)||!['sourceRoot','mediaRoot','radarrRoot','quarantineRoot','reviewRoot'].every(k=>absolutePOSIX(cfg[k])))fail('invalid frozen library roots');
 if(!Array.isArray(cfg.reviewPrefixes)||!cfg.reviewPrefixes.every(relativePrefix)||new Set(cfg.reviewPrefixes).size!==cfg.reviewPrefixes.length)fail('invalid frozen review prefixes');
}
function validateImportedHistory(c,registry,cfg){
 // Historical completed metadata can outlive the registry that once authorized
 // its operation. It is not current authority: no registry entry is synthesized,
 // no decode result is inferred, and no other lifecycle phase is exempted.
 if(c.status!=='replacement_imported'||!positive(c.mutationStarted)||!object(c.binding))fail('historical state approval is absent or different');
 validateMappings(registry,cfg);
 validateFrozenIdentity(c.approval,cfg,c.id);
 const a=c.approval;
 if((Object.hasOwn(a,'id')&&a.id!==c.id)||c.movieId!==a.movieId||['file','relative','fp','size'].some(k=>c[k]!==a[k])||c.source!==cfg.mediaRoot+'/'+a.relative||c.binding.sourceTitle!==a.sourceTitle||c.binding.movieFileId!==a.movieFileId)fail('imported historical source or binding differs');
 if(Object.hasOwn(c.binding,'downloadId')&&c.binding.downloadId!==a.downloadId)fail('imported historical binding identity differs');
}
function validateState(state,registry,cfg,{present}){
 if(!object(state)||!object(state.cases))fail('invalid recovery state');
 for(const [id,c] of Object.entries(state.cases)){
  if(!object(c))fail('invalid recovery case');
  if(Object.hasOwn(c,'approval')){
   if(id!==c.id)fail('historical state approval is absent or different');
   if(!registryHasApproval(registry,c)){
    // A changed member is never downgraded to a historical nonmember exception.
    if(!present||registry.cases.some(a=>a.id===c.id))fail('historical state approval is absent or different');
    validateImportedHistory(c,registry,cfg);continue;
   }
   for(const k of ['file','fp','size','relative'])if(c[k]!==undefined&&c[k]!==c.approval[k])fail('historical state source differs from its approval');
  }
 }
}
function validateRegistry(value,{cfg,state,legacy=false,present=true}){
 if(!object(value)||Object.keys(value).some(k=>!['version','config','cases'].includes(k))||((!legacy||Object.hasOwn(value,'version'))&&value.version!==1)||!object(value.config)||!Array.isArray(value.cases))fail('unsupported registry shape or version');
 if(!object(cfg))fail('invalid recovery configuration');
 if(value.cases.length>1000)fail('too many frozen cases');
 if(frozenConfigDifference(value.config,cfg)!==null)fail('frozen configuration differs');
 if(value.cases.length)validateMappings(value,cfg);
 const ids=new Set();for(const a of value.cases){validateCase(a,cfg);if(ids.has(a.id))fail('duplicate frozen case identity');ids.add(a.id);}
 const registry={version:1,config:value.config,cases:value.cases};validateState(state,registry,cfg,{present});return freeze(registry);
}

export function registryHasApproval(registry,c){
 return object(c)&&object(c.approval)&&text(c.id)&&c.approval.id===c.id&&Array.isArray(registry?.cases)&&registry.cases.some(a=>a.id===c.id&&equal(a,c.approval));
}
export async function loadApprovalRegistry({data,cfg,state}){
 const root=await directory(data);let source;
 try{source=await readPrivate(path.join(root,NAME));}catch(e){
  if(e.code!=='ENOENT')throw e;
  // Stored state is evidence about earlier operations, never authorization to
  // recreate a missing private registry from the copies it happens to contain.
  return validateRegistry({version:1,config:{},cases:[]},{cfg,state,present:false});
 }
 return validateRegistry(parse(source.bytes),{cfg,state});
}
async function syncDirectory(root){
 if(process.platform==='win32')return;
 const h=await fs.open(root,'r');try{await h.sync();}finally{await h.close();}
}
async function exclusiveFile(file,bytes){
 const h=await fs.open(file,'wx',0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}
}

export async function migrateApprovalRegistry({source,data,cfg,state}){
 const root=await directory(data);
 if(!text(source)||!path.isAbsolute(source))fail('migration requires an explicit absolute legacy source');
 const original=await readPrivate(path.resolve(source));
 const registry=validateRegistry(parse(original.bytes),{cfg,state,legacy:true});
 const target=path.join(root,NAME),serialized=Buffer.from(JSON.stringify(registry,null,2)+'\n');
 try{
  const installed=validateRegistry(parse((await readPrivate(target)).bytes),{cfg,state});
  if(!equal(installed,registry))fail('existing registry differs; replacement is forbidden');
  return {version:1,caseCount:registry.cases.length,alreadyInstalled:true,registrySHA256:digest(Buffer.from(canonical(registry)))};
 }catch(e){if(e.code!=='ENOENT')throw e;}
 const statePath=path.join(root,'state.json'),saved=await readPrivate(statePath);
 if(!equal(parse(saved.bytes),state))fail('recovery state changed before migration');
 const backupName='registry-migration-'+crypto.randomBytes(12).toString('hex'),backup=path.join(root,backupName);
 await fs.mkdir(backup,{mode:0o700});
 // Verify the newly created directory before placing any private evidence in it.
 if(await directory(backup)!==backup)fail('migration backup directory changed');
 await exclusiveFile(path.join(backup,'pending-approvals.source.json'),original.bytes);
 await exclusiveFile(path.join(backup,'state.json'),saved.bytes);
 await exclusiveFile(path.join(backup,'manifest.json'),Buffer.from(JSON.stringify({version:1,sourceSHA256:digest(original.bytes),stateSHA256:digest(saved.bytes),caseCount:registry.cases.length},null,2)+'\n'));
 await syncDirectory(backup);await syncDirectory(root);
 const sourceAgain=await readPrivate(path.resolve(source)),stateAgain=await readPrivate(statePath);
 if(sourceAgain.stamp!==original.stamp||!sourceAgain.bytes.equals(original.bytes)||stateAgain.stamp!==saved.stamp||!stateAgain.bytes.equals(saved.bytes))fail('source or state changed during migration');
 const temporary=path.join(root,'.pending-approvals-'+crypto.randomBytes(12).toString('hex')+'.tmp');
 await exclusiveFile(temporary,serialized);
 try{
  // link is an atomic exclusive installation: it cannot overwrite a registry
  // that appeared after the earlier check. No rename-overwrite fallback.
  await fs.link(temporary,target);
 }catch(e){if(e.code==='EEXIST')fail('registry appeared during migration; replacement is forbidden');throw e;}
 finally{await fs.unlink(temporary);}
 await syncDirectory(root);
 const installed=await loadApprovalRegistry({data:root,cfg,state});
 if(!equal(installed,registry))fail('installed registry verification failed');
 return {version:1,caseCount:registry.cases.length,alreadyInstalled:false,registrySHA256:digest(Buffer.from(canonical(registry))),sourceSHA256:digest(original.bytes),backupDirectory:backupName};
}
