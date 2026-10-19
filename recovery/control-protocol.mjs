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


// IPC channels: worker ↔ supervisor, and Review ↔ supervisor (request and reply).
export const CHANNELS=Object.freeze({worker:'recovery-worker',control:'recovery-control',reply:'recovery-control-reply'});
// A request in one of these states blocks a new drain and is ended by a worker exit.
export const PENDING_STATES=Object.freeze(['draining','ready','stopping','starting']);
export const MAX_REQUEST_IDS=1024;

/**
 * The settings-apply control state machine (docs/ARCHITECTURE.md, "Settings apply control"), without I/O.
 * The supervisor executes the commands in order: `send` a worker command (on a false send result it
 * applies `onFail`: a control state, an error reply, or both), `start` the worker, `clearRestart`,
 * `markUsed` a request id, `awaitExit` of the worker. A reply of `snapshot` is read after the commands.
 * @typedef {{id:string,state:string,reason:string|null}} Control
 * @typedef {{type:'send',action:'drain'|'cancel'|'stop',onFail:{control?:Partial<Control>,error?:string}}|{type:'start'}|{type:'clearRestart'}|{type:'markUsed',id:string}|{type:'awaitExit'}} Command
 * @param {{control:Control|null,mode:string,session:string,worker:boolean,restarting:boolean,resumeCrash:boolean,used:{has(id:string):boolean,size:number},stopping:boolean}} context
 * @param {{type:'request',action?:string,id:string,session?:string|null}|{type:'worker',event?:string,id?:string}|{type:'exit'}} event
 * @returns {{control:Control|null,reply?:'snapshot'|{error:string},commands:Command[],resumeCrash?:boolean,intentional?:boolean}}
 */
export function controlTransition(context,event){
 const {control,mode,worker}=context,next=control&&{...control};
 const reply=(result,commands=[],extra={})=>({control:next,reply:result,commands,...extra});
 const refuse=error=>({control,reply:{error},commands:[]});
 if(event.type==='worker'){
  if(event.event==='ready'&&next?.state==='starting')next.state='running';
  if(event.event==='drained'&&next?.state==='draining'&&event.id===next.id)next.state='ready';
  return {control:next,commands:[]};
 }
 if(event.type==='exit'){
  if(!next||!PENDING_STATES.includes(next.state))return {control,commands:[]};
  const intentional=next.state==='stopping';
  next.state=intentional?'stopped':'failed';next.reason=intentional?null:'worker-exited';
  return {control:next,commands:[],intentional};
 }
 if(event.session!==null&&event.session!==context.session)return refuse('recovery_control_session_expired');
 if(context.stopping)return refuse('recovery_control_stopping');
 if(event.action==='requestDrain'){
  if(control&&control.id===event.id)return reply('snapshot');
  if(control&&PENDING_STATES.includes(control.state))return refuse('recovery_control_pending');
  if(context.used.has(event.id)||context.used.size>=MAX_REQUEST_IDS)return refuse('recovery_control_id_expired');
  /** @type {Control} */
  const fresh={id:event.id,state:mode==='off'?'off':'draining',reason:null};
  /** @type {Command[]} */
  const commands=[{type:'markUsed',id:event.id},{type:'clearRestart'}];
  if(mode!=='off'&&!worker)fresh.state='ready';
  else if(mode!=='off')commands.push({type:'send',action:'drain',onFail:{control:{state:'failed',reason:'worker-unavailable'}}});
  return {control:fresh,reply:'snapshot',commands,resumeCrash:context.restarting};
 }
 if(event.session!==context.session||!control||control.id!==event.id)return refuse('recovery_control_request_expired');
 if(event.action==='status')return reply('snapshot');
 if(event.action==='cancel'){
  if(control.state==='cancelled')return reply('snapshot');
  if(!['draining','ready','off'].includes(control.state))return refuse('recovery_control_cannot_cancel');
  next.state='cancelled';
  // A failed cancel leaves the request as it was.
  if(worker)return reply('snapshot',[{type:'send',action:'cancel',onFail:{control:{state:control.state},error:'recovery_control_worker_unavailable'}}]);
  return reply('snapshot',context.resumeCrash?[{type:'start'}]:[]);
 }
 if(event.action==='stopAfterDrain'){
  if(control.state==='stopping')return reply('snapshot',[{type:'awaitExit'}]);
  if(control.state==='stopped')return reply('snapshot');
  if(!['ready','off'].includes(control.state))return refuse('recovery_control_not_drained');
  if(!worker){next.state='stopped';return reply('snapshot');}
  next.state='stopping';
  return reply('snapshot',[{type:'send',action:'stop',onFail:{control:{state:'failed'},error:'recovery_control_worker_unavailable'}},{type:'awaitExit'}]);
 }
 if(event.action==='restart'){
  if(['starting','running','off'].includes(control.state))return reply('snapshot');
  if(control.state!=='stopped')return refuse('recovery_control_not_stopped');
  if(mode==='off'){next.state='off';return reply('snapshot');}
  next.state='starting';
  return reply('snapshot',[{type:'start'}]);
 }
 return refuse('recovery_control_action_invalid');
}

/**
 * Executes a transition's commands in order with the supervisor's effects. A false `send` result
 * applies its onFail and stops: an error reply, or the snapshot of the failed state.
 * @param {{control:Control|null,reply?:'snapshot'|{error:string},commands:Command[]}} step
 * @param {{send(action:string):boolean,start():void,clearRestart():void,markUsed(id:string):void,awaitExit():Promise<void>|void,setControl(control:Control|null):void,snapshot():object}} effects
 */
export async function runControlCommands(step,effects){
 effects.setControl(step.control);
 for(const command of step.commands){
  if(command.type==='markUsed')effects.markUsed(command.id);
  else if(command.type==='clearRestart')effects.clearRestart();
  else if(command.type==='start')effects.start();
  else if(command.type==='awaitExit')await effects.awaitExit();
  else if(command.type==='send'&&!effects.send(command.action)){
   if(command.onFail.control)effects.setControl({.../** @type {Control} */(step.control),...command.onFail.control});
   if(command.onFail.error)return {error:command.onFail.error};
   break;
  }
 }
 return typeof step.reply==='object'?step.reply:effects.snapshot();
}
