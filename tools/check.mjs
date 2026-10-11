import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
async function walk(root){
  for(const entry of await fs.readdir(root,{withFileTypes:true})){
    const file=path.join(root,entry.name);
    if(entry.isDirectory())await walk(file);
    else if(/\.(?:mjs|cjs|js)$/.test(file)){
      const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
      if(result.status!==0)process.exit(result.status??1);
    }
  }
}
for(const directory of ['review','recovery','tools'])await walk(directory);
console.log('JavaScript syntax checked.');
