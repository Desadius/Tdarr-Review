// The review-session rules shared by the server (review/review-session.mjs) and the browser workflow
// (review-workflow.js), so both apply the same rule (docs/REVIEW-WORKFLOW-DESIGN.md). Pure, without DOM.
// The server is the only authority for saving and completion. The browser is deliberately stricter: it
// passes { hdr } to stepReachable and requires deviceSatisfied before a step can be left, whereas the server
// asks for the named device and the HDR confirmation only at completion.

export const CHECKS=Object.freeze(['preparation','image','audio','syncStart','syncMiddle','syncEnd','hdr']);
// Checks of each step: preparation, picture, audio, synchronisation, decision.
export const STEP_CHECKS=Object.freeze([['preparation'],['image'],['audio'],['syncStart','syncMiddle','syncEnd'],[]].map(Object.freeze));
const AUDIO_AND_SYNC=Object.freeze(['audio','syncStart','syncMiddle','syncEnd']);

/** The checks of a step; with HDR required the picture step also holds the HDR confirmation. */
export const stepChecks=(step,{hdr=false}={})=>step===1&&hdr?['image','hdr']:[...STEP_CHECKS[step]];

/** A track pair is selected when both indexes are integers. */
export const hasPair=scope=>Number.isInteger(scope?.originalIndex)&&Number.isInteger(scope?.reviewIndex);

/** Every step before `step` is confirmed and, from synchronisation on, a track pair is selected. */
export const stepReachable=(session,step,{hdr=false}={})=>STEP_CHECKS.slice(0,step).every((_,i)=>stepChecks(i,{hdr}).every(key=>session.checks[key]===true))&&(step<3||hasPair(session.scope));

/** The furthest step whose earlier steps are all confirmed, without HDR gating (the server's step). */
export function completedStep(session){let step=0;while(step<4&&stepReachable(session,step+1))step++;return step;}

/** At least two characters after trimming. */
export const deviceNamed=device=>typeof device==='string'&&device.trim().length>=2;
/** A review on an external player, or any review with HDR required, names its device. */
export const deviceSatisfied=(session,{hdr=false}={})=>session.method!=='external'&&!hdr||deviceNamed(session.device);

export const identityChanged=(before,after)=>before.method!==after.method||before.device!==after.device;
export const pairChanged=(before,after)=>before.scope.originalIndex!==after.scope.originalIndex||before.scope.reviewIndex!==after.scope.reviewIndex;

/** A changed method or device clears every confirmation and returns to the first step. Changes `session`. */
export function clearForIdentity(session){for(const key of CHECKS)session.checks[key]=false;session.step=0;return session;}
/** A changed track pair clears audio and synchronisation and caps the step at audio. Changes `session`. */
export function clearForPair(session){for(const key of AUDIO_AND_SYNC)session.checks[key]=false;session.step=Math.min(session.step,2);return session;}
