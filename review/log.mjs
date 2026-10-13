// One JSON line per operator-relevant event, so `docker logs` can reconstruct what happened.
// Values under secret-looking names are never written, and long strings are truncated.
const SECRET=/key|token|secret|password|passwd|cookie|authorization|session/i;
const MAX_STRING=500;

function clean(value,depth=0){
 if(typeof value==='string')return value.length>MAX_STRING?value.slice(0,MAX_STRING)+'…':value;
 if(value===null||typeof value!=='object')return typeof value==='bigint'?String(value):value;
 if(depth>=4)return '[nested]';
 if(Array.isArray(value))return value.slice(0,20).map(item=>clean(item,depth+1));
 const out={};
 for(const [name,item] of Object.entries(value)){if(SECRET.test(name)||item===undefined||typeof item==='function')continue;out[name]=clean(item,depth+1)}
 return out;
}

export function formatEvent(event,fields={},now=new Date()){
 return JSON.stringify({...clean(fields),time:now.toISOString(),source:'review',event});
}

export function logEvent(event,fields={},write=line=>console.log(line)){
 try{write(formatEvent(event,fields))}catch{}
}
