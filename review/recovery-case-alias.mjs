// @ts-check
import fs from 'node:fs/promises';
import path from 'node:path';
import {caseLibraryRoot} from './recovery-case-paths.mjs';

// Recovery records a case's library and quarantine paths under its own mount of the media share
// (for example /storage/movies and /storage/.tdarr-corrupt), while Review reads the same share as its
// mediaRoot (/media/movies). Review rewrites those two paths to its own mount only when the recorded
// library root and Review's mediaRoot, and their parents, are provably the same directory (same device
// and inode). Anything else is returned unchanged, so every existing identity and binding check still
// decides. Tdarr paths (`file`) and relative paths are never rewritten.

const safeRelative=value=>typeof value==='string'&&!!value&&!value.startsWith('/')&&!value.includes('\\')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');

/** Whether two absolute paths name the same existing directory. */
export async function sameDirectory(a,b){
 if(path.resolve(a)===path.resolve(b))return true;
 try{const [x,y]=await Promise.all([fs.stat(a),fs.stat(b)]);return x.isDirectory()&&y.isDirectory()&&x.dev===y.dev&&x.ino===y.ino;}
 catch{return false;}
}

/**
 * Recovery cases with `source` and `quarantine` expressed under Review's mediaRoot where both mounts are the same share.
 * @param {Record<string,any>|null|undefined} cases
 * @param {string|undefined} mediaRoot Review's library root.
 */
export async function withReviewPaths(cases,mediaRoot){
 if(!cases||typeof mediaRoot!=='string'||!path.isAbsolute(mediaRoot))return cases;
 const review=path.resolve(mediaRoot),reviewParent=path.dirname(review),verdicts=new Map(),out={};
 for(const [id,c] of Object.entries(cases)){
  const root=caseLibraryRoot(c);
  if(!root||!path.isAbsolute(root)||!safeRelative(c.relative)||path.resolve(root)===review){out[id]=c;continue;}
  const key=path.resolve(root);
  if(!verdicts.has(key))verdicts.set(key,await sameDirectory(key,review)&&await sameDirectory(path.dirname(key),reviewParent));
  if(!verdicts.get(key)){out[id]=c;continue;}
  const parent=path.dirname(key)+path.sep,copy={...c,source:path.join(review,...c.relative.split('/'))};
  if(typeof c.quarantine==='string'&&c.quarantine.startsWith(parent))copy.quarantine=path.join(reviewParent,c.quarantine.slice(parent.length));
  out[id]=copy;
 }
 return out;
}
