import path from 'node:path';

// The value rules of config.json. Each rule accepts what the worker's readers of that key work
// with today; a value they cannot use (a string limit compares as NaN, so "stableMinutes": "ten"
// silently disabled the stability check) refuses start-up instead. Unknown keys are ignored.
// A problem names the key and the rule, never the value (docs/CONFIGURATION.md, config.json).
export const text=v=>typeof v==='string'&&v.trim().length>0&&!v.includes('\0');
// A review prefix relative to reviewRoot (shared with the approval registry's frozen check).
export function relativePrefix(p){return text(p)&&!p.startsWith('/')&&!p.includes('\\')&&!/^[A-Za-z]:/.test(p)&&!p.endsWith('/')&&path.posix.normalize(p)===p&&!p.split('/').some(s=>!s||s==='.'||s==='..');}
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const number=min=>v=>typeof v==='number'&&Number.isFinite(v)&&v>=min;
// Node fires a timer longer than 2^31-1 ms after 1 ms instead, so a delay must stay below it.
const TIMER_MS=2**31-1;
const delay=unitMs=>v=>number(0)(v)&&v*unitMs<=TIMER_MS;
// Worker paths: absolute and not the filesystem root, under which within() refuses every path.
const workerPath=v=>text(v)&&path.isAbsolute(v)&&path.resolve(v)!==path.parse(path.resolve(v)).root;
// Readers append '/'+relative to the remote roots, so a trailing separator never matches.
const remoteRoot=v=>text(v)&&!/[\\/]$/.test(v);
const RULES={
 // API connections and the remote side's paths (Tdarr server and Radarr may use any path style).
 tdarrUrl:['a non-empty string',text],
 radarrUrl:['a non-empty string',text],
 radarrApiKey:['a non-empty string',text],
 libraryId:['a non-empty string',text],
 sourceRoot:['a non-empty string without a trailing slash',remoteRoot],
 radarrRoot:['a non-empty string without a trailing slash',remoteRoot],
 // Paths inside the worker.
 mediaRoot:['an absolute path other than the root',workerPath],
 reviewRoot:['an absolute path other than the root',workerPath],
 quarantineRoot:['an absolute path other than the root',workerPath],
 database:['an absolute path other than the root',workerPath],
 reports:['an absolute path other than the root',workerPath],
 ffmpeg:['an absolute path other than the root',workerPath],
 ffprobe:['an absolute path other than the root',workerPath,'optional'],
 reviewPrefixes:['a list of relative paths below reviewRoot',v=>Array.isArray(v)&&v.every(relativePrefix)],
 // Limits. 0 is valid where the worker works with it (no wait, no cooldown, every job).
 stableMinutes:['a number of 0 or more',number(0)],
 confirmDelaySeconds:['a number from 0 to 2147483',delay(1000)],
 movieCooldownDays:['a number of 0 or more',number(0)],
 pollSeconds:['a number from 0 to 2147483',delay(1000)],
 since:['a number of 0 or more (Unix milliseconds)',number(0)],
 decodeTimeoutHours:['a number greater than 0 and at most 596',v=>delay(3600000)(v)&&v>0],
 maxRepairsPerDay:['a whole number of 1 or more',v=>Number.isSafeInteger(v)&&v>0],
 // Switches and historical exceptions; absent means off or empty.
 fullSourceHash:['true or false',v=>typeof v==='boolean','optional'],
 detectTerminalHeaders:['true or false',v=>typeof v==='boolean','optional'],
 approvedCaseIds:['a list of non-empty strings',v=>Array.isArray(v)&&v.every(text),'optional'],
 approvedImportRepairs:['an object of objects',v=>object(v)&&Object.values(v).every(object),'optional'],
};
// The first problem with a parsed config.json object, or null. enabled is checked with the mode.
export function configValueProblem(value){
 for(const [key,[rule,valid,optional]] of Object.entries(RULES)){
  if(!Object.hasOwn(value,key)){if(optional)continue;return key+' is missing';}
  if(!valid(value[key]))return key+' must be '+rule;
 }
 return null;
}
