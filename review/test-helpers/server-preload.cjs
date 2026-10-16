// Child-only instrumentation; never loaded by the application itself.
const {registerHooks}=require('node:module');
const {appendFileSync}=require('node:fs');
if(process.env.REVIEW_TEST_CLOCK==='1'){
 const now=Date.now,interval=setInterval,callbacks=new Map();let offset=0;
 Date.now=()=>now()+offset;
 // Only tick() runs an interval callback, so a real timer cannot add an unrequested run.
 global.setInterval=(fn,ms,...args)=>{callbacks.set(ms,()=>fn(...args));return interval(()=>{},ms)};
 process.on('message',message=>{offset+=message.advance||0;if(message.interval)callbacks.get(message.interval)?.();process.send({ack:message.id})});
}
if(process.env.REVIEW_TEST_TRACE){
 const names={library:'libraryRoutes',items:'itemRoutes',previews:'previewRoutes',settings:'settingsRoutes',nodes:'nodeRoutes',static:'staticRoutes'},wrappers=new Map();
 const server=new URL('../server.mjs','file://'+__filename).href;
 registerHooks({
  resolve(specifier,context,next){
   const resolved=next(specifier,context);
   if(context.parentURL===server&&specifier.startsWith('./routes/')){
    const name=names[specifier.slice(9,-4)];
    if(name){const url='fixture-route:'+name;wrappers.set(url,{name,original:resolved.url});return {url,shortCircuit:true}}
   }
   return resolved;
  },
  load(url,context,next){
   if(!wrappers.has(url))return next(url,context);
   const {name,original}=wrappers.get(url);
   return {format:'module',shortCircuit:true,source:`
    import {appendFileSync} from 'node:fs';
    import {${name} as route} from ${JSON.stringify(original)};
    export function ${name}(...args){
     appendFileSync(process.env.REVIEW_TEST_TRACE,JSON.stringify({route:${JSON.stringify(name)},method:args[1].method,url:args[1].url})+String.fromCharCode(10));
     return route(...args);
    }`};
  }
 });
}
