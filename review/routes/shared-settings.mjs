import {body,reply} from './http.mjs';

export function settingsError(error){
 const code=/^(?:settings|recovery_control)_[a-z_]+$/.test(error?.code||error?.message||'')?(error.code||error.message):'settings_operation_failed';
 return {error:code,code,...(typeof error?.field==='string'&&/^[A-Za-z.]+$/.test(error.field)?{field:error.field}:{})};
}
export async function failedSettingsSave(store,error){
 const result=settingsError(error);
 // Audit changes the document revision. Return the fresh token so a corrected form can save;
 // clients must still reload on a genuine concurrent-edit conflict.
 try{await store.recordOutcome({action:'save',result:'failure'});result.revision=(await store.public()).revision;}
 catch{result.auditError='settings_audit_failed';}
 return result;
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
  let saving=false;
  try{
   const input=await body(req);
   if(action==='cancel')return reply(res,200,await ctx.settingsApply.cancel(input.id));
   if(ctx.settingsBusy)return reply(res,409,{error:'settings_busy',code:'settings_busy'});
   if(typeof input.revision!=='string')return reply(res,409,{error:'settings_conflict',code:'settings_conflict'});
   if(action==='apply')return reply(res,202,await ctx.settingsApply.start(input));
   if(action==='test'){await ctx.settingsApply.test(input);return reply(res,200,{ok:true});}
   saving=true;await ctx.sharedSettings.saveDraft(input);return reply(res,200,await ctx.sharedSettings.public());
  }catch(error){return reply(res,error.status||409,saving?await failedSettingsSave(ctx.sharedSettings,error):settingsError(error));}
 }
 return false;
}
