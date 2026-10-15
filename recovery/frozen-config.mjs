// The one rule for comparing the approval registry's frozen config with the configuration the
// worker runs with. Every reader of the registry (start-up gate, configChange validator, pending
// approvals, offline migration) uses it, so they accept and refuse the same combinations.
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(object(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
export const sameValue=(a,b)=>canonical(a)===canonical(b);

// Verify is strictly narrower than Repair (in-flight repairs pause, #87), so a registry approved for
// Repair (frozen enabled: true) also accepts Verify. Frozen false still refuses Repair (fail closed).
// Every other key keeps the exact-match rule.
export function frozenValueAccepts(key,frozen,running){
 if(key==='enabled'&&frozen===true&&running===false)return true;
 return sameValue(frozen,running);
}

// The first frozen key the running configuration does not satisfy, or null. Never returns a value.
export function frozenConfigDifference(frozen,cfg){
 for(const [k,v] of Object.entries(frozen))if(!Object.hasOwn(cfg,k)||!frozenValueAccepts(k,v,cfg[k]))return k;
 return null;
}

// The Recovery modes a registry with this frozen config allows, for the shared status file:
// null when enabled is not frozen (no restriction), otherwise the modes in which it loads.
export function registryAllowedModes(frozen){
 if(!object(frozen)||!Object.hasOwn(frozen,'enabled'))return null;
 return ['verify','repair'].filter(mode=>frozenValueAccepts('enabled',frozen.enabled,mode==='repair'));
}
