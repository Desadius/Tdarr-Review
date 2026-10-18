import fs from 'node:fs/promises';
import path from 'node:path';

// Every place that carries a default version must agree with package.json.
export async function versionMismatches(root='.'){
 const read=file=>fs.readFile(path.join(root,file),'utf8');
 const {version}=JSON.parse(await read('package.json'));
 const found=[];
 // The project publishes one image (tdarr-review); Recovery runs inside it.
 found.push(['Dockerfile APP_VERSION',/^ARG APP_VERSION=(.*)$/m.exec(await read('Dockerfile'))?.[1]?.trim()]);
 found.push(['.env.example REVIEW_IMAGE_TAG',/^REVIEW_IMAGE_TAG=(.*)$/m.exec(await read('.env.example'))?.[1]?.trim()]);
 return found.filter(([,value])=>value!==version).map(([where,value])=>where+' is '+(value??'missing')+', package.json is '+version);
}

// Browser module URLs carry the app version only through the placeholder the static route fills in.
export async function moduleVersionLiterals(root='.'){
 const dir=path.join(root,'review','public'),found=[];
 for(const name of (await fs.readdir(dir)).filter(name=>/\.(?:js|html|css)$/.test(name)).sort()){
  for(const [literal] of (await fs.readFile(path.join(dir,name),'utf8')).matchAll(/\?v=[^'"`)\s]*/g))if(literal!=='?v=__APP_VERSION__')found.push('review/public/'+name+' uses '+literal+' instead of ?v=__APP_VERSION__');
 }
 return found;
}
