export const CONTROL_VERSION=1;
export const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(id);
/**
 * @param {unknown} m
 * @returns {m is {version:number,channel?:string,session?:string,id?:string,token?:string,event?:string,action?:string}}
 */
export const controlMessage=m=>m&&typeof m==='object'&&m.version===CONTROL_VERSION;
export function sendControl(transport,message){
 if(!transport?.connected||typeof transport.send!=='function')return false;
 try{transport.send(message,()=>{});return true;}catch{return false;}
}

