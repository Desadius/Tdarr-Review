import fs from 'node:fs/promises';
import path from 'node:path';

/** Lists the .mkv files below `dir` (relative paths, `prefix` prepended). Symlinks and dot entries are skipped. */
export async function walk(dir,prefix=''){
  const result=[];
  for(const e of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])){
    if(e.isSymbolicLink()||e.name.startsWith('.'))continue;
    const rel=prefix?prefix+'/'+e.name:e.name;
    if(e.isDirectory()&&rel.split('/').length<12)result.push(...await walk(path.join(dir,e.name),rel));
    else if(e.isFile()&&e.name.toLowerCase().endsWith('.mkv'))result.push(rel);
  }return result;
}
