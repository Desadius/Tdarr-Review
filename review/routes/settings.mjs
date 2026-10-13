import {hash,atomicJSON} from '../core.mjs';
import {validate,checkPaths} from '../config.mjs';
import {body,reply} from './http.mjs';
import {logEvent} from '../log.mjs';

// Tdarr connection and path settings. Saving resets cached items, previews and review sessions.
export async function settingsRoutes(ctx,req,res,url,request){
 if(url.pathname==='/api/settings'&&req.method==='GET')return reply(res,200,{config:ctx.config,revision:hash(JSON.stringify(ctx.config))});
 if(['/api/settings/test','/api/settings'].includes(url.pathname)&&req.method==='POST'){
  const b=await body(req);
  if(ctx.busyFor('settings',request.mutation))return reply(res,409,{error:'Nejprve dokonči probíhající akce, náhled nebo obnovu.'});
  if(b.revision!==hash(JSON.stringify(ctx.config)))return reply(res,409,{error:'Nastavení se mezitím změnilo. Otevři ho znovu.'});
  ctx.settingsBusy=true;
  try{
   const candidate=validate(b.config);await checkPaths(candidate);
   const r=await fetch(candidate.tdarrUrl+'/api/v2/get-nodes',{signal:AbortSignal.timeout(12000)});
   if(!r.ok)throw Error('Připojení k Tdarru selhalo: '+r.status);
   const nodes=await r.json();if(!nodes||typeof nodes!=='object'||Array.isArray(nodes))throw Error('Neplatná odpověď Tdarru.');
   const libraries=await ctx.readRows('librarysettingsjsondb',candidate);await ctx.readRows('jobsjsondb',candidate);
   const matches=libraries.filter(l=>candidate.libraryId?l._id===candidate.libraryId:candidate.sourceRoots.includes(String(l.folder).replace(/\/$/,'')));
   if(matches.length!==1||!candidate.sourceRoots.includes(String(matches[0].folder).replace(/\/$/,'')))throw Error('Vyber jednoznačnou knihovnu a její zdrojovou cestu v Tdarru.');
   if(url.pathname==='/api/settings'){
    await ctx.previews.invalidate({all:true});ctx.previewPairs.clear();ctx.previewPlans.clear();ctx.previewAttempts.clear();
    await atomicJSON(ctx.configfile,candidate);ctx.config=candidate;ctx.applyConfig();ctx.statsCache=null;ctx.state.items={};ctx.state.reviewSessions={};ctx.cache=null;ctx.cacheAt=0;await ctx.save();
    logEvent('settings.saved',{publicOrigin:candidate.publicOrigin,tdarrUrl:candidate.tdarrUrl,mediaRoot:candidate.mediaRoot,reviewRoot:candidate.reviewRoot,libraryId:candidate.libraryId});
   }
   return reply(res,200,{ok:true,message:'Připojení, databáze a cesty jsou dostupné.',publicOrigin:candidate.publicOrigin,revision:hash(JSON.stringify(ctx.config))});
  }finally{ctx.settingsBusy=false}
 }
 return false;
}
