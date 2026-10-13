// Policies describe application work, not authentication or approval authority.
// A foreground reservation covers request parsing, preview draining and preflight
// before the longer-running active/settings/preview flags are set.
const foreground=['foreground','active','batchRunning','resumeTask','previewBusy','settingsBusy','reviewSessions'];
const settled=['recovery','pauses'];
const scan=['scan'];
export const BUSY_POLICIES=Object.freeze({
 // These actions join an existing scan for their own fresh preflight. Their
 // reservation prevents a second mutation while that scan is awaited.
 approve:Object.freeze([...foreground,...settled]),
 reject:Object.freeze([...foreground,...settled]),
 batch:Object.freeze([...foreground,...settled]),
 replace:Object.freeze([...foreground,...settled]),
 restore:Object.freeze([...foreground,...scan,...settled]),
 recheck:Object.freeze([...foreground,...scan,...settled]),
 settings:Object.freeze([...foreground,...scan,...settled,'statistics']),
 // Connection/cache configuration cannot replace media or resume dispatch.
 // Keep these available for troubleshooting an unresolved recovery/pause.
 radarrSettings:Object.freeze([...foreground,...scan]),
 previewSettings:Object.freeze([...foreground,...scan]),
 // On-demand previews only read media; unresolved recovery/pause is allowed.
 // A currently running resume is still excluded, like other foreground work.
 preview:Object.freeze([...foreground,...scan]),
 // Review writes serialize and compare revisions in their own CAS queue. Do
 // not exclude that queue from itself; all other mutations exclude it.
 reviewSession:Object.freeze([...foreground.filter(flag=>flag!=='reviewSessions'),...scan,...settled]),
 // Discovery persists item metadata, so readers use the last cache while a
 // mutation owns the state. An owning preflight may scan; scans coalesce.
 scan:Object.freeze([...foreground]),
 // Review retries owned node pauses, but only once foreground work and
 // unresolved replacement recovery have finished. Pending pauses are its input.
 resume:Object.freeze([...foreground,...scan,'recovery']),
 background:Object.freeze([...foreground,...scan,...settled,'previewHolds']),
 // Forgetting a pending node restore is allowed during an action (that is when a
 // node paused by the user would be resumed) but never while a resume is running.
 keepPaused:Object.freeze(['foreground','resumeTask']),
});

export function busyFor(kind,activities){
 const flags=BUSY_POLICIES[kind];
 if(!flags)throw new Error('Unknown busy policy: '+kind);
 return flags.find(flag=>activities[flag])||null;
}

// Only authenticated application actions are classified here. Login retains
// its existing independent authentication/session persistence rules.
export function mutationKind(method,pathname){
 if(method!=='POST')return null;
 if(/^\/api\/settings(?:\/test)?$/.test(pathname))return 'settings';
 if(/^\/api\/radarr\/settings(?:\/test)?$/.test(pathname))return 'radarrSettings';
 if(pathname==='/api/preview-settings')return 'previewSettings';
 if(pathname==='/api/approve-batch')return 'batch';
 if(pathname==='/api/node-restores/keep')return 'keepPaused';
 if(/^\/api\/radarr\/requests\/[a-f0-9]{24}\/restore$/.test(pathname))return 'restore';
 const action=/^\/api\/items\/[a-f0-9]{24}\/(approve|reject|replace|recheck|review-session)$/.exec(pathname)?.[1];
 return action==='review-session'?'reviewSession':action||null;
}
