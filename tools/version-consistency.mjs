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

// The release line, image tags and REVIEW_IMAGE_TAG in the README and the installation guide name
// the current release. Other documents keep the versions they describe (for example the 2.0 migration).
const VERSION_DOCS=['README.md','docs/INSTALL-UNRAID.md'];
const DOC_VERSION=/Release version: \*\*\[(\d+\.\d+\.\d+[^\]]*)\]\([^)]*\/v(\d+\.\d+\.\d+[^)]*)\)|tdarr-review:(\d+\.\d+\.\d+[^\s`'")]*)|REVIEW_IMAGE_TAG=(\d+\.\d+\.\d+[^\s`'")]*)/g;
export async function docVersionMismatches(root='.'){
 const {version}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')),found=[];
 for(const file of VERSION_DOCS){
  let text;try{text=await fs.readFile(path.join(root,file),'utf8')}catch(e){if(e.code==='ENOENT'){found.push(file+' is missing');continue}throw e}
  text.split('\n').forEach((line,i)=>{for(const match of line.matchAll(DOC_VERSION))for(const value of match.slice(1).filter(Boolean))if(value!==version)found.push(file+':'+(i+1)+' names '+value+', package.json is '+version)});
 }
 return found;
}

// Browser module URLs carry the app version only through the placeholder the static route fills in.
export async function moduleVersionLiterals(root='.'){
 const dir=path.join(root,'review','public'),found=[];
 for(const name of (await fs.readdir(dir)).filter(name=>/\.(?:js|html|css)$/.test(name)).sort()){
  for(const [literal] of (await fs.readFile(path.join(dir,name),'utf8')).matchAll(/\?v=[^'"`)\s]*/g))if(literal!=='?v=__APP_VERSION__')found.push('review/public/'+name+' uses '+literal+' instead of ?v=__APP_VERSION__');
 }
 return found;
}
