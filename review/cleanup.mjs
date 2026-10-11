import fs from 'node:fs/promises';
import path from 'node:path';
import {safeFile,fingerprint} from './core.mjs';

const reserved=new Set(['PROD-Movies','PC-LANG-v2','PC-test']);
// Capture only our matching receipt before the reviewed media is removed.
export async function captureReceipt(root,relative,sourceRelative,mediaStat){
  try{
    const file=await safeFile(root,relative+'.tdarr-receipt.json');
    if(file.stat.size>65536)return null;
    const receipt=JSON.parse(await fs.readFile(file.path,'utf8'));
    if(receipt.version!==1||receipt.relative!==sourceRelative||receipt.output?.size!==mediaStat.size||receipt.output?.mtime!==Math.round(mediaStat.mtimeMs))return null;
    return file;
  }catch(e){if(e.code==='ENOENT')return null;return null;}
}

// Empty-only removal: never recurse through symlinks or delete other contents.
export async function pruneEmpty(root,prefixes=[...reserved]){
  root=await fs.realpath(root);
  let removed=0;
  async function visit(dir){
    for(const entry of await fs.readdir(dir,{withFileTypes:true})){
      if(!entry.isDirectory()||entry.isSymbolicLink())continue;
      const child=path.join(dir,entry.name);
      const st=await fs.lstat(child);
      if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(child)!==child)continue;
      await visit(child);
      if(dir===root&&prefixes.includes(entry.name))continue;
      try{await fs.rmdir(child);removed++;}catch(e){if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(e.code))throw e;}
    }
  }
  await visit(root);return removed;
}

export async function cleanupReviewed(root,relative,receipt,prefixes=[...reserved]){
  const media=path.resolve(root,relative);
  if(!media.startsWith(path.resolve(root)+path.sep))throw Error('Invalid review path');
  try{await fs.lstat(media);return 0;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(receipt){
    const current=await safeFile(root,relative+'.tdarr-receipt.json').catch(e=>{if(e.code!=='ENOENT')throw e;return null});
    if(current&&current.fp===receipt.fp)await fs.unlink(current.path);
  }
  return pruneEmpty(root,prefixes);
}
