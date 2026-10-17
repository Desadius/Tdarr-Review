import fs from 'node:fs/promises';
import path from 'node:path';
import {errorText} from './public/error-messages.js';

// Shared read-only preflight for settings diagnostics and replacement preparation.
// A missing target is allowed: the replacement creates it later, never diagnostics.
export async function checkManualQuarantine({mediaRoot,quarantineRoot,source=mediaRoot}){
 const root=await fs.realpath(mediaRoot),target=quarantineRoot||path.join(path.dirname(root),'.tdarr-review-quarantine');
 if(target===root||target.startsWith(root+path.sep)||root.startsWith(target+path.sep))throw Error('Karanténa originálů musí ležet mimo filmovou knihovnu.');
 const parent=path.dirname(target);if(await fs.realpath(parent)!==parent)throw Error('Rodič karantény nesmí být symlink.');
 const parentStat=await fs.lstat(parent),sourcePath=await fs.realpath(source),sourceStat=await fs.stat(sourcePath);
 if(!parentStat.isDirectory()||parentStat.isSymbolicLink())throw Error(errorText('settings_manual_quarantine_unavailable'));
 await fs.access(parent,fs.constants.W_OK|fs.constants.X_OK);
 if(parentStat.dev!==sourceStat.dev)throw Error('Karanténa musí ležet na stejném souborovém systému jako originál.');
 let targetStat;try{targetStat=await fs.lstat(target);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(targetStat){
  if(!targetStat.isDirectory()||targetStat.isSymbolicLink()||await fs.realpath(target)!==target||targetStat.dev!==sourceStat.dev)throw Error(errorText('settings_manual_quarantine_unavailable'));
  await fs.access(target,fs.constants.R_OK|fs.constants.W_OK|fs.constants.X_OK);
 }
 if(process.platform==='linux'){
  const mounts=(await fs.readFile('/proc/self/mountinfo','utf8')).trim().split('\n').map(line=>{const fields=line.split(' ');return {id:fields[0],point:fields[4].replace(/\\([0-7]{3})/g,(_,v)=>String.fromCharCode(parseInt(v,8)))}});
  const mount=p=>mounts.filter(m=>p===m.point||p.startsWith(m.point==='/'?'/':m.point+'/')).sort((a,b)=>b.point.length-a.point.length)[0]?.id;
  if(mount(sourcePath)!==mount(parent)||targetStat&&mount(sourcePath)!==mount(target))throw Error('Originál a karanténu připoj jedním společným Docker mountem. Přesun mezi mounty není bezpečně možný.');
 }
}
