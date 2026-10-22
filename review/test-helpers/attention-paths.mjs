// Synthetic Recovery and Radarr request records for every path into Needs attention (#229).
export const now=Date.UTC(2026,9,22,12),fresh=new Date(now-60000).toISOString(),old=new Date(now-3600000).toISOString();
const id='a'.repeat(24),child='b'.repeat(24);
const recovery=fields=>({source:'recovery',id,title:'Synthetic film',statusUpdated:fresh,...fields});
const radarr=fields=>({source:'radarr',id,title:'Synthetic film',updated:fresh,...fields});
export const ATTENTION_PATHS={
 'binding failure, original confirmed':recovery({phase:'manual',bindingFailure:'import-missing',sourceConfirmed:true}),
 'binding failure, original not confirmed':recovery({phase:'manual',bindingFailure:'import-missing',sourceConfirmed:false}),
 'binding failure with another copy offered':recovery({phase:'manual',bindingFailure:'import-missing',sourceConfirmed:true,sourceReplacement:{snapshot:'c'.repeat(64)}}),
 'manual recovery case':recovery({phase:'manual',reason:'Interrupted holding; inspect journal before any retry'}),
 'manual Radarr request':radarr({phase:'manual'}),
 'original check did not confirm a fault':recovery({phase:'no_action',originalCheckKind:'unconfirmed'}),
 'fault confirmed in Verify':recovery({phase:'dry_run'}),
 'replacement transcoded, awaiting review':recovery({phase:'replacement_imported',tdarrStatus:'Transcode success'}),
 'replacement transcode error':recovery({phase:'replacement_imported',tdarrStatus:'Transcode error'}),
 'replacement skipped as not required':recovery({phase:'replacement_imported',tdarrStatus:'Not required'}),
 'replacement on hold in Tdarr':recovery({phase:'replacement_imported',tdarrStatus:'Hold'}),
 'follow-up case completed under a parent':recovery({phase:'replacement_imported',replacementFollowupId:child,replacementFollowup:{id:child,source:'recovery',phase:'no_action',originalCheckKind:'healthy',statusUpdated:fresh}}),
 'original outside the library for over 24 hours':recovery({phase:'waiting_replacement',verifyPausedStep:'replacement_request',originalOutsideLibrary:true,originalOutsideSince:new Date(now-25*3600000).toISOString()}),
 'search failed':recovery({phase:'waiting_replacement',search:{status:'failed'}}),
 'download queue failed':recovery({phase:'waiting_replacement',queue:[{status:'failed',title:'Release'}]}),
 'import blocked':recovery({phase:'waiting_replacement',queue:[{status:'completed',trackedDownloadState:'importBlocked',title:'Release'}]}),
 'case error':recovery({phase:'waiting_replacement',search:{status:'completed'},error:'Replacement file size does not match Radarr'}),
 'retention error':recovery({phase:'replacement_imported',tdarrStatus:'Queued',retentionError:'Retention identity changed'}),
 'stale status, not attention':recovery({phase:'waiting_replacement',search:{status:'completed'},statusUpdated:old}),
};
