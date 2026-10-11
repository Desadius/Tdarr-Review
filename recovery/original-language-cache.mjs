import fs from 'node:fs/promises';import path from 'node:path';
export async function refreshOriginalLanguages({cfg,rad,atomic}){
 const target=path.join(cfg.mediaRoot,'.tdarr-original-languages.json');
 try{const old=JSON.parse(await fs.readFile(target,'utf8'));if(old.version===1&&Date.now()-Date.parse(old.generatedAt)<10*60000)return;}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
 const movies=await rad('/movie');if(!Array.isArray(movies))throw Error('Invalid Radarr language response');
 const entries=Object.create(null),root=cfg.radarrRoot+'/';
 for(const m of movies){const f=m.movieFile;if(!f?.path?.startsWith(root)||!Number.isSafeInteger(f.size)||f.size<=0)continue;const relative=f.path.slice(root.length);if(relative.split('/').some(v=>!v||v==='.'||v==='..'))continue;
  const entry={tmdbId:m.tmdbId,movieId:m.id,bytes:f.size,originalLanguage:m.originalLanguage?.name||null};
  if(entries[relative])entries[relative]={ambiguous:true};else entries[relative]=entry;
 }
 await atomic(target,{version:1,source:'Radarr movie metadata (TMDB identity)',generatedAt:new Date().toISOString(),entries});await fs.chmod(target,0o644);
}
