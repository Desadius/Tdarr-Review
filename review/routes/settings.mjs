import {body,reply} from './http.mjs';
import {settingsError,failedSettingsSave} from './shared-settings.mjs';
import {logEvent} from '../log.mjs';

// Legacy editor compatibility: Save stages the shared draft; only explicit Apply activates it.
export async function settingsRoutes(ctx,req,res,url){
 if(url.pathname==='/api/settings'&&req.method==='GET'){
  const shared=await ctx.sharedSettings.public();return reply(res,200,{config:ctx.config,revision:shared.revision,draft:shared.draft,managed:shared.managed});
 }
 if(['/api/settings/test','/api/settings'].includes(url.pathname)&&req.method==='POST'){
  let saving=false;
  try{
   const input=await body(req);
   if(url.pathname.endsWith('/test')){await ctx.settingsApply.test(input);return reply(res,200,{ok:true});}
   saving=true;await ctx.sharedSettings.saveDraft({revision:input.revision,patch:{review:input.config},resolutions:input.resolutions||[],acknowledgeHistory:input.acknowledgeHistory});
   logEvent('settings.saved',{draft:true,active:false});
   return reply(res,200,{ok:true,...await ctx.sharedSettings.public()});
  }catch(error){return reply(res,error.status||409,saving?await failedSettingsSave(ctx.sharedSettings,error):settingsError(error));}
 }
 return false;
}
