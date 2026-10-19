import {CONTROL_VERSION,controlMessage,sendControl,validId,CHANNELS} from './control-protocol.mjs';
// Admission is checked between complete journaled operations. No active operation is interrupted.
export function createWorkerControl({transport=process,wake=()=>{},session=process.env.RECOVERY_CONTROL_SESSION}={}){
 let request=null,stopped=false,quiescent=false;
 const reply=event=>sendControl(transport,{channel:CHANNELS.worker,version:CONTROL_VERSION,session,id:request,event});
 const receive=m=>{
  if(!controlMessage(m)||m.channel!==CHANNELS.worker||m.session!==session||!validId(m.id))return;
  if(m.action==='drain'&&request===null){request=m.id;wake();}
  if(m.id!==request)return;
  if(m.action==='cancel'&&!stopped){request=null;quiescent=false;wake();}
  if(m.action==='stop'&&quiescent){stopped=true;wake();}
 };
 transport.on('message',receive);
 return {canStart:()=>request===null&&!stopped,stopped:()=>stopped,checkpoint:()=>{if(request!==null){quiescent=true;reply('drained');}},ready:()=>reply('ready'),close:()=>transport.off('message',receive)};
}

