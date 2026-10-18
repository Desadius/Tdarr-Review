import fs from 'node:fs/promises';
import path from 'node:path';
import {requestArtworkIdentity} from '../artwork.mjs';
import {statistics} from '../stats.mjs';
import {quarantineRetention} from '../../recovery/quarantine-retention.mjs';
import {body,reply,apiError} from './http.mjs';
import {logEvent} from '../log.mjs';
import {readRecoveryRuntime} from '../recovery-runtime.mjs';
import {settingsRequest} from './shared-settings.mjs';

// Posters, statistics, quarantine listing and Radarr replacement requests/settings.
export async function libraryRoutes(ctx,req,res,url,request){
 const poster=/^\/api\/artwork\/(review|request)\/([a-f0-9]{24})$/.exec(url.pathname);
 if(poster&&req.method==='GET'){
  let record;
  if(poster[1]==='review')record=(await ctx.scan()).find(item=>item.id===poster[2]);
  else{
   const visible=(await ctx.replacements.list()).find(item=>item.id===poster[2]);
   if(visible)record=await requestArtworkIdentity(ctx.DATA,visible);
  }
  if(!record)return reply(res,404,apiError('poster_unavailable'));
  const image=await ctx.artwork.lookup(poster[1],record);
  if(!image)return reply(res,404,apiError('poster_unavailable'));
  const headers={'content-type':image.mime,'cache-control':'private, max-age=300','x-content-type-options':'nosniff','x-artwork-status':image.status,'etag':image.etag,'content-security-policy':"default-src 'none'; frame-ancestors 'none'"};
  if(req.headers['if-none-match']===image.etag){res.writeHead(304,headers);res.end();return true;}
  res.writeHead(200,{...headers,'content-length':image.body.length});res.end(image.body);return true;
 }
 if(url.pathname==='/api/statistics'&&req.method==='GET'){
  if(ctx.settingsBusy)return reply(res,409,apiError('settings_changing'));
  if(!ctx.statsCache||Date.now()-ctx.statsCache.at>60000){
   if(!ctx.statsTask)ctx.statsTask=(async()=>{const result=await statistics({dbRows:ctx.dbRows,config:structuredClone(ctx.config),data:ctx.DATA,items:await ctx.scan()});ctx.statsCache=result;return result})().finally(()=>{ctx.statsTask=null});
   await ctx.statsTask;
  }
  return reply(res,200,ctx.statsCache);
 }
 if(url.pathname==='/api/quarantine'&&req.method==='GET'){
  const parent=path.dirname(await fs.realpath(ctx.config.mediaRoot)),settings=await ctx.replacements.publicSettings();
  const roots=[path.join(parent,'.tdarr-corrupt'),settings.quarantineRoot||path.join(parent,'.tdarr-review-quarantine'),path.join(await fs.realpath(ctx.config.reviewRoot),'.radarr-quarantine')];
  const files=[],warnings=[];
  for(const root of [...new Set(roots)]){
   try{
    if(await fs.realpath(root)!==root)throw Error('Karanténa nesmí být symlink.');
    for(const entry of await fs.readdir(root,{withFileTypes:true})){
     if(!entry.isDirectory()||entry.isSymbolicLink())continue;
     const folder=path.join(root,entry.name);if(await fs.realpath(folder)!==folder)continue;
     for(const name of await fs.readdir(folder)){
      const file=path.join(folder,name),st=await fs.lstat(file);
      if(st.isFile()&&!st.isSymbolicLink())files.push({caseId:entry.name,name,path:file,bytes:st.size});
     }
    }
   }catch(e){if(e.code!=='ENOENT')warnings.push('Nelze načíst '+root+': '+e.message);}
  }
  return reply(res,200,{files,warnings,...quarantineRetention});
 }
 if(url.pathname==='/api/radarr/settings'&&req.method==='GET'){const shared=await ctx.sharedSettings.public();return reply(res,200,{...await ctx.replacements.publicSettings(),revision:shared.revision,draft:shared.draft.radarr});}
 if(['/api/radarr/settings','/api/radarr/settings/test'].includes(url.pathname)&&req.method==='POST'){
  return settingsRequest(ctx,res,async save=>{const b=await body(req);if(url.pathname.endsWith('/test')){await ctx.settingsApply.test(b);return reply(res,200,{ok:true});}
   const patch=Object.fromEntries(['url','apiKey','mediaRoot','quarantineRoot','preferCzechEnglish'].filter(k=>Object.hasOwn(b,k)).map(k=>[k,b[k]]));
   await save({revision:b.revision,patch:{radarr:patch},resolutions:b.resolutions||[],acknowledgeHistory:b.acknowledgeHistory});logEvent('radarr-settings.saved',{draft:true,active:false});return reply(res,200,{ok:true,...await ctx.sharedSettings.public()});
  });
 }
 if(url.pathname==='/api/radarr/requests'&&req.method==='GET')return reply(res,200,await ctx.replacements.overview());
 // Runtime diagnostics remain readable even when the separate case snapshot fails.
 if(url.pathname==='/api/recovery/runtime'&&req.method==='GET')return reply(res,200,await readRecoveryRuntime(path.join(ctx.DATA,'recovery','runtime-state.json')));
 const restoreRequest=/^\/api\/radarr\/requests\/([a-f0-9]{24})\/restore$/.exec(url.pathname);
 if(restoreRequest&&req.method==='POST'){
  const b=await body(req);if(b.confirm!==true)return reply(res,400,apiError('restore_confirm_required'));
  if(ctx.busyFor('restore',request.mutation))return reply(res,409,apiError('busy'));
  ctx.active={title:'Obnovení karantény',stage:'Ověřuji soubory',started:Date.now()};
  try{const result=await ctx.replacements.restore(restoreRequest[1]);logEvent('quarantine.restored',{requestId:restoreRequest[1],id:result.itemId});await ctx.forgetPreviews(result.itemId);delete ctx.state.items[result.itemId];delete ctx.state.reviewSessions[result.itemId];await ctx.save();return reply(res,200,result)}finally{ctx.active=null;ctx.cache=null}
 }
 return false;
}
