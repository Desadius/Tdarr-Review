import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Development-only type check (maintainer-approved exception to "no dependencies").
// Pinned tools go into the git-ignored .typecheck/ folder; nothing is added to
// package.json or the Docker images.
export const TOOLS={typescript:'6.0.3','@types/node':'24.19.0'};
const root=fileURLToPath(new URL('../',import.meta.url)),prefix=path.join(root,'.typecheck');

function installed(){
 try{return Object.entries(TOOLS).every(([name,version])=>JSON.parse(fs.readFileSync(path.join(prefix,'node_modules',name,'package.json'),'utf8')).version===version)}catch{return false}
}
function run(command,args,{shell=false}={}){
 const result=spawnSync(command,args,{cwd:root,stdio:'inherit',shell});
 if(result.error)throw result.error;
 return result.status??1;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!installed()){
  const status=run('npm',['install','--prefix',prefix,'--no-save','--no-package-lock','--ignore-scripts','--no-audit','--no-fund',...Object.entries(TOOLS).map(([name,version])=>name+'@'+version)],{shell:process.platform==='win32'});
  if(status!==0)process.exit(status);
 }
 process.exit(run(process.execPath,[path.join(prefix,'node_modules','typescript','bin','tsc'),'-p','tsconfig.typecheck.json']));
}
