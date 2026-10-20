import {body,reply} from './http.mjs';
import {settingsError,failedSettingsSave} from '../settings-errors.mjs';

// One settings request: a failure before the draft save is a plain settings error; a failed save is
// audited and answered with the fresh revision a corrected form needs.
export async function settingsRequest(ctx,res,handler){
 let saving=false;
 const save=async draft=>{saving=true;await ctx.sharedSettings.saveDraft(draft);};
 try{return await handler(save);}
 catch(error){return reply(res,error.status||409,saving?await failedSettingsSave(ctx.sharedSettings,error):settingsError(error));}
}
export async function sharedSettingsRoutes(ctx,req,res,url){
 if(!/^\/api\/shared-settings(?:\/(?:draft|test|apply|cancel|status|audit))?$/.test(url.pathname))return false;
 const action=url.pathname.split('/')[3];
 if(req.method==='GET'){
  if(!action)return reply(res,200,{...await ctx.sharedSettings.public(),apply:ctx.settingsApply.status(),history:await ctx.sharedSettings.audit()});
  if(action==='status')return reply(res,200,ctx.settingsApply.status());
  if(action==='audit')return reply(res,200,{history:await ctx.sharedSettings.audit()});
 }
 if(req.method==='POST'&&['draft','test','apply','cancel'].includes(action)){
  return settingsRequest(ctx,res,async save=>{
   const input=await body(req);
   if(action==='cancel')return reply(res,200,await ctx.settingsApply.cancel(input.id));
   if(ctx.settingsBusy)return reply(res,409,{error:'settings_busy',code:'settings_busy'});
   if(typeof input.revision!=='string')return reply(res,409,{error:'settings_conflict',code:'settings_conflict'});
   if(action==='apply')return reply(res,202,await ctx.settingsApply.start(input));
   if(action==='test')return reply(res,200,await ctx.settingsApply.test(input));
   await save(input);return reply(res,200,await ctx.sharedSettings.public());
  });
 }
 return false;
}
