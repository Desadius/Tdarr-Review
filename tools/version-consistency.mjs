import fs from 'node:fs/promises';
import path from 'node:path';

// Every place that carries a default version must agree with package.json.
export async function versionMismatches(root='.'){
 const read=file=>fs.readFile(path.join(root,file),'utf8');
 const {version}=JSON.parse(await read('package.json'));
 const found=[];
 for(const file of ['Dockerfile','Dockerfile.recovery'])found.push([file+' APP_VERSION',/^ARG APP_VERSION=(.*)$/m.exec(await read(file))?.[1]?.trim()]);
 const env=await read('.env.example');
 for(const key of ['REVIEW_IMAGE_TAG','RECOVERY_IMAGE_TAG'])found.push(['.env.example '+key,new RegExp('^'+key+'=(.*)$','m').exec(env)?.[1]?.trim()]);
 return found.filter(([,value])=>value!==version).map(([where,value])=>where+' is '+(value??'missing')+', package.json is '+version);
}
