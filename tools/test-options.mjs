import fs from 'node:fs/promises';
import path from 'node:path';
const skipSummary=new URL('./skip-summary.mjs',import.meta.url).href;
export function testRunnerFlags(args=[]){
  if(args.length>1||args.some(arg=>arg!=='--coverage'))throw Error('Usage: node tools/test.mjs [--coverage]');
  return ['--test','--test-concurrency=1','--test-reporter=spec','--test-reporter-destination=stdout','--test-reporter='+skipSummary,'--test-reporter-destination=stderr',...(args[0]==='--coverage'?['--experimental-test-coverage']:[])];
}
export async function listTestFiles(root='.',shard=''){
  const files=[];
  for(const directory of ['review','recovery','tools']){
    for(const name of (await fs.readdir(path.join(root,directory))).sort()){
      if(/\.test\.(mjs|cjs)$/.test(name)||(directory!=='tools'&&(name==='test.mjs'||name==='test-artwork.mjs'))) files.push(directory+'/'+name);
    }
  }
  return selectShard(files,shard);
}
// TEST_SHARD=i/n runs every n-th file starting at the i-th, so CI can split the suite across jobs without gaps or overlap.
export function selectShard(files,shard=''){
  if(!shard)return files;
  const match=/^([1-9]\d*)\/([1-9]\d*)$/.exec(shard);
  if(!match||Number(match[1])>Number(match[2]))throw Error('TEST_SHARD must be i/n with 1 <= i <= n, got: '+shard);
  const index=Number(match[1])-1,count=Number(match[2]);
  return files.filter((_,position)=>position%count===index);
}
