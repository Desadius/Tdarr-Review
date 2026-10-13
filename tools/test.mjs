import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const files=[];
for(const directory of ['review','recovery','tools']){
  for(const name of (await fs.readdir(directory)).sort()){
    if(/\.test\.(mjs|cjs)$/.test(name)||(directory!=='tools'&&(name==='test.mjs'||name==='test-artwork.mjs'))) files.push(directory+'/'+name);
  }
}
const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...files],{stdio:'inherit'});
if(result.error)throw result.error;
process.exit(result.status??1);
