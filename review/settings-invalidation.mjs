import {sameValue} from '../recovery/frozen-config.mjs';

// How much of the saved review work a settings Apply invalidates, from the Review settings that change
// between the configuration in effect and the one being committed (GLOSSARY.md, "Review binding"):
// - none: only fields that no saved review depends on;
// - samples: only the FFmpeg path, so prepared samples go, saved reviews and Approve decisions stay;
// - all: anything else. Every Review field that is not listed below, including one added later, is part
//   of the review binding and invalidates saved reviews, Approve decisions, the film list and samples.
// The Radarr section and Recovery-only fields are not Review settings and invalidate nothing.
export const NO_INVALIDATION=Object.freeze(['label','publicOrigin']);
export const SAMPLES_ONLY=Object.freeze(['ffmpeg']);
export const LEVELS=Object.freeze(['none','samples','all']);

const rank=level=>LEVELS.indexOf(level);
/** True when `level` invalidates more than `than`. Against an unknown `than` every level is stricter (fail closed). */
export const stricter=(level,than)=>rank(level)>rank(than);

/** The level and the Review field names causing it, comparing validated (normalized) Review settings. */
export function invalidationLevel(before,after){
 const fields=[...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].filter(key=>!sameValue(before?.[key],after?.[key])).sort();
 const level=fields.some(key=>!NO_INVALIDATION.includes(key)&&!SAMPLES_ONLY.includes(key))?'all':fields.some(key=>SAMPLES_ONLY.includes(key))?'samples':'none';
 return {level,fields:fields.filter(key=>level==='all'?!NO_INVALIDATION.includes(key)&&!SAMPLES_ONLY.includes(key):level==='samples'?SAMPLES_ONLY.includes(key):false)};
}
