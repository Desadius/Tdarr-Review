import fs from 'node:fs/promises';
import path from 'node:path';
const skipSummary=new URL('./skip-summary.mjs',import.meta.url).href;
export function testRunnerFlags(args=[]){
  if(args.length>1||args.some(arg=>arg!=='--coverage'))throw Error('Usage: node tools/test.mjs [--coverage]');
  return ['--test','--test-concurrency=1','--test-reporter=spec','--test-reporter-destination=stdout','--test-reporter='+skipSummary,'--test-reporter-destination=stderr',...(args[0]==='--coverage'?['--experimental-test-coverage']:[])];
}
export async function listTestFiles(root='.'){
  const files=[];
  for(const directory of ['review','recovery','tools']){
    for(const name of (await fs.readdir(path.join(root,directory))).sort()){
      if(/\.test\.(mjs|cjs)$/.test(name)||(directory!=='tools'&&(name==='test.mjs'||name==='test-artwork.mjs'))) files.push(directory+'/'+name);
    }
  }
  return files;
}
