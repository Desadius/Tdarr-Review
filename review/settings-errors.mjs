// Settings failures as public, value-free codes. Shared by the settings routes and settings apply.
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
