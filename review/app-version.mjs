import fs from 'node:fs/promises';

// package.json is the single source of the version. The Docker build passes it as
// APP_VERSION (the image does not contain package.json); a source checkout reads it.
const VERSION=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export async function appVersion({env=process.env,packageFile=new URL('../package.json',import.meta.url)}={}){
 if(VERSION.test(env.APP_VERSION||''))return env.APP_VERSION;
 try{const {version}=JSON.parse(await fs.readFile(packageFile,'utf8'));if(VERSION.test(version||''))return version;}catch{}
 return 'unknown';
}
