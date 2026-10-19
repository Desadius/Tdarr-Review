import {randomUUID} from 'node:crypto';
import {CONTROL_VERSION,validId,controlMessage,sendControl,CHANNELS,controlTransition,runControlCommands} from '../recovery/control-protocol.mjs';
export {CONTROL_VERSION,validId,controlMessage,sendControl,CHANNELS,controlTransition,runControlCommands};
// Messages carry no configuration or secret values. Only the supervisor's own Review child can request control.
export function createRecoveryControlClient({transport=process}={}){
 let session=null;
 const call=(action,id)=>new Promise((resolve,reject)=>{
  if(!validId(id))return reject(Error('recovery_control_id_invalid'));
  if(!transport?.connected)return reject(Error('recovery_control_unavailable'));
  const token=randomUUID();
  const done=(error,result)=>{clearTimeout(timer);transport.off('message',receive);transport.off('disconnect',disconnect);error?reject(error):resolve(result);};
  const disconnect=()=>done(Error('recovery_control_unavailable'));
  const receive=m=>{if(!controlMessage(m)||m.channel!==CHANNELS.reply||m.token!==token)return;if(m.error)return done(Object.assign(Error(m.error),{code:m.error}));session=m.result.session;done(null,m.result);};
  // An acknowledged drain may still be flushing durable status on slow storage. Wait for exit,
  // without a settings timeout; a lost supervisor still rejects through disconnect.
  const timer=action==='stopAfterDrain'?null:setTimeout(()=>done(Error('recovery_control_unavailable')),5000);timer?.unref?.();
  transport.on('message',receive);transport.once('disconnect',disconnect);
  if(!sendControl(transport,{channel:CHANNELS.control,version:CONTROL_VERSION,token,session,action,id}))disconnect();
 });
 const client=Object.fromEntries(['requestDrain','status','cancel','stopAfterDrain','restart'].map(action=>[action,id=>call(action,id)]));
 client.wait=async id=>{for(;;){const snapshot=await client.status(id);if(snapshot.state!=='draining'&&snapshot.state!=='starting')return snapshot;await new Promise(r=>setTimeout(r,25));}};
 return client;
}

