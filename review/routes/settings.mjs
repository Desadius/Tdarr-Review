import {body,reply} from './http.mjs';
import {settingsRequest} from './shared-settings.mjs';
import {logEvent} from '../log.mjs';

// Legacy editor compatibility: Save stages the shared draft; only explicit Apply activates it.
export async function settingsRoutes(ctx,req,res,url){
 if(url.pathname==='/api/settings'&&req.method==='GET'){
  const shared=await ctx.sharedSettings.public();return reply(res,200,{config:ctx.config,revision:shared.revision,draft:shared.draft,managed:shared.managed});
 }
 if(['/api/settings/test','/api/settings'].includes(url.pathname)&&req.method==='POST'){
  return settingsRequest(ctx,res,async save=>{
   const input=await body(req);
   if(url.pathname.endsWith('/test')){await ctx.settingsApply.test(input);return reply(res,200,{ok:true});}
   await save({revision:input.revision,patch:{review:input.config},resolutions:input.resolutions||[],acknowledgeHistory:input.acknowledgeHistory});
   logEvent('settings.saved',{draft:true,active:false});
   return reply(res,200,{ok:true,...await ctx.sharedSettings.public()});
  });
 }
 return false;
}
