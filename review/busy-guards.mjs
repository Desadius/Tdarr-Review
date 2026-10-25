// Policies describe application work, not authentication or approval authority.
// A foreground reservation covers request parsing, preview draining and preflight
// before the longer-running active/settings/preview flags are set.
const foreground=['foreground','active','batchRunning','resumeTask','previewBusy','settingsBusy','reviewSessions','recoveryRestore'];
const settled=['recovery','pauses'];
const scan=['scan'];
export const BUSY_POLICIES=Object.freeze({
 sharedSettings:Object.freeze([...foreground]),
 // These actions join an existing scan for their own fresh preflight. Their
 // reservation prevents a second mutation while that scan is awaited.
 approve:Object.freeze([...foreground,...settled]),
 // Queueing a confirmed replacement during a running one checks every other approve blocker.
 approveQueued:Object.freeze([...foreground.filter(flag=>!['active','batchRunning'].includes(flag)),...settled]),
 reject:Object.freeze([...foreground,...settled]),
 batch:Object.freeze([...foreground,...settled]),
 replace:Object.freeze([...foreground,...settled]),
 restore:Object.freeze([...foreground,...scan,...settled]),
 restoreReconcile:Object.freeze([...foreground.filter(flag=>flag!=='recoveryRestore'),...scan,...settled]),
 recheck:Object.freeze([...foreground,...scan,...settled]),
 settings:Object.freeze([...foreground,...scan,...settled,'statistics']),
 // Connection/cache configuration cannot replace media or resume dispatch.
 // Keep these available for troubleshooting an unresolved recovery/pause.
 radarrSettings:Object.freeze([...foreground,...scan]),
 previewSettings:Object.freeze([...foreground,...scan]),
 // On-demand previews only read media; unresolved recovery/pause is allowed.
 // A currently running resume is still excluded, like other foreground work.
 // A running replacement or batch does not exclude previews of other films; the routes
 // refuse the film that is being replaced or waits in the batch (item_in_operation).
 preview:Object.freeze([...foreground.filter(flag=>!['active','batchRunning'].includes(flag)),...scan]),
 // Review writes serialize and compare revisions in their own CAS queue. Do
 // not exclude that queue from itself; all other mutations exclude it.
 // Reviews of other films stay possible while a replacement or batch runs (same per-film rule).
 reviewSession:Object.freeze([...foreground.filter(flag=>!['reviewSessions','active','batchRunning'].includes(flag)),...scan,...settled]),
 // Discovery persists item metadata, so readers use the last cache while a
 // mutation owns the state. An owning preflight may scan; scans coalesce.
 scan:Object.freeze([...foreground]),
 // Review retries owned node pauses, but only once foreground work and
 // unresolved replacement recovery have finished. Pending pauses are its input.
 resume:Object.freeze([...foreground,...scan,'recovery']),
 background:Object.freeze([...foreground,...scan,...settled,'previewHolds']),
 // Forgetting a pending node restore is allowed during an action (that is when a
 // node paused by the user would be resumed) but never while a resume is running.
 keepPaused:Object.freeze(['foreground','resumeTask','recoveryRestore']),
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
 if(/^\/api\/shared-settings\/(?:draft|test)$/.test(pathname))return 'sharedSettings';
 if(/^\/api\/settings(?:\/test)?$/.test(pathname))return 'settings';
 if(/^\/api\/radarr\/settings(?:\/test)?$/.test(pathname))return 'radarrSettings';
 if(pathname==='/api/preview-settings')return 'previewSettings';
 if(pathname==='/api/approve-batch')return 'batch';
 if(pathname==='/api/node-restores/keep')return 'keepPaused';
 if(/^\/api\/radarr\/requests\/[a-f0-9]{24}\/restore$/.test(pathname))return 'restore';
 if(/^\/api\/recovery\/cases\/[a-f0-9]{24}\/restore-original$/.test(pathname))return 'restore';
 if(/^\/api\/recovery\/cases\/[a-f0-9]{24}\/restore-original\/reconcile$/.test(pathname))return 'restoreReconcile';
 // Manual replacement of a confirmed faulty original without a Review result (#153).
 if(/^\/api\/recovery\/cases\/[a-f0-9]{24}\/replace-source$/.test(pathname))return 'replace';
 // Assessment of an installed result (#230): the draft is review state; approval publishes retention evidence.
 if(/^\/api\/recovery\/cases\/[a-f0-9]{24}\/installed$/.test(pathname))return 'reviewSession';
 if(/^\/api\/recovery\/cases\/[a-f0-9]{24}\/installed\/approve$/.test(pathname))return 'replace';
 // Review's Tdarr handoff of an imported replacement without a Tdarr row (#231).
 if(/^\/api\/recovery\/cases\/[a-f0-9]{24}\/handoff$/.test(pathname))return 'replace';
 // The one Review retry of a failed replacement transcode (#232).
 if(/^\/api\/recovery\/cases\/[a-f0-9]{24}\/retry$/.test(pathname))return 'replace';
 const action=/^\/api\/items\/[a-f0-9]{24}\/(approve|reject|replace|recheck|review-session|approval)$/.exec(pathname)?.[1];
 // Approval without replacement writes review state only, like a saved review.
 return action==='review-session'||action==='approval'?'reviewSession':action||null;
}
