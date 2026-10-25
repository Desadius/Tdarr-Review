// Paths and times of a Recovery case as Review derives them (#230, #231, #232). Recovery records the
// original's library path (source), its Tdarr path (file) and their shared relative path; the imported
// replacement lives under the same roots at replacementRelative.

/** Review-side library root of the case, or null when the recorded paths do not share the relative path. */
export function caseLibraryRoot(c){const suffix='/'+c?.relative;return typeof c?.source==='string'&&typeof c.relative==='string'&&c.source.endsWith(suffix)?c.source.slice(0,-suffix.length):null;}
/** Tdarr path of the imported replacement, or null. */
export function replacementTdarrFile(c){const suffix='/'+c?.relative;return typeof c?.file==='string'&&typeof c.relative==='string'&&typeof c.replacementRelative==='string'&&c.file.endsWith(suffix)?c.file.slice(0,-suffix.length)+'/'+c.replacementRelative:null;}
/** When the replacement reached the library: the later of its recorded modification and change times. */
export function importTime(fp){const parts=String(fp||'').split(':');return parts.length===5?Math.max(Number(parts[3]),Number(parts[4])):NaN;}
