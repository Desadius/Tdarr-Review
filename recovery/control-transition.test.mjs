import test from 'node:test';
import assert from 'node:assert/strict';
import {controlTransition,runControlCommands,CHANNELS,PENDING_STATES,MAX_REQUEST_IDS} from './control-protocol.mjs';

// Every settings-apply control transition of the supervisor, without spawning processes (#197).
const session='s1',freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const v of Object.values(value))freeze(v)}return value};
const ctx=(control=null,extra={})=>freeze({control,mode:'repair',session,worker:true,restarting:false,resumeCrash:false,used:new Set(),stopping:false,...extra});
const request=(action,id='a',extra={})=>({type:'request',action,id,session,...extra});
const at=state=>({id:'a',state,reason:null});
const drainFail={type:'send',action:'drain',onFail:{control:{state:'failed',reason:'worker-unavailable'}}};

test('channel names and pending states are the protocol constants',()=>{
 assert.deepEqual(CHANNELS,{worker:'recovery-worker',control:'recovery-control',reply:'recovery-control-reply'});
 assert.deepEqual(PENDING_STATES,['draining','ready','stopping','starting']);
});

test('requestDrain starts a drain, reuses the same request and refuses others',()=>{
 const cases=[
  ['worker running',ctx(),request('requestDrain',undefined,{session:null}),{control:at('draining'),reply:'snapshot',commands:[{type:'markUsed',id:'a'},{type:'clearRestart'},drainFail],resumeCrash:false}],
  ['no worker',ctx(null,{worker:false}),request('requestDrain'),{control:at('ready'),reply:'snapshot',commands:[{type:'markUsed',id:'a'},{type:'clearRestart'}],resumeCrash:false}],
  ['crash restart pending',ctx(null,{worker:false,restarting:true}),request('requestDrain'),{control:at('ready'),reply:'snapshot',commands:[{type:'markUsed',id:'a'},{type:'clearRestart'}],resumeCrash:true}],
  ['mode off',ctx(null,{mode:'off',worker:false}),request('requestDrain'),{control:at('off'),reply:'snapshot',commands:[{type:'markUsed',id:'a'},{type:'clearRestart'}],resumeCrash:false}],
  ['same request again',ctx(at('draining')),request('requestDrain'),{control:at('draining'),reply:'snapshot',commands:[]}],
  ['after an ended request',ctx({id:'old',state:'stopped',reason:null},{used:new Set(['old'])}),request('requestDrain'),{control:at('draining'),reply:'snapshot',commands:[{type:'markUsed',id:'a'},{type:'clearRestart'},drainFail],resumeCrash:false}],
 ];
 for(const [name,context,event,expected] of cases)assert.deepEqual(controlTransition(context,event),expected,name);
 for(const state of PENDING_STATES)assert.deepEqual(controlTransition(ctx({id:'other',state,reason:null}),request('requestDrain')).reply,{error:'recovery_control_pending'},state);
 assert.deepEqual(controlTransition(ctx(null,{used:new Set(['a'])}),request('requestDrain')).reply,{error:'recovery_control_id_expired'});
 assert.deepEqual(controlTransition(ctx(null,{used:{has:()=>false,size:MAX_REQUEST_IDS}}),request('requestDrain')).reply,{error:'recovery_control_id_expired'});
});

test('session, stopping and request identity are checked before any action',()=>{
 assert.deepEqual(controlTransition(ctx(at('draining')),request('status','a',{session:'old'})),{control:at('draining'),reply:{error:'recovery_control_session_expired'},commands:[]});
 assert.deepEqual(controlTransition(ctx(at('draining'),{stopping:true}),request('requestDrain','b')).reply,{error:'recovery_control_stopping'});
 for(const [control,event] of [[null,request('status')],[at('draining'),request('status','b')],[at('draining'),request('status','a',{session:null})]])
  assert.deepEqual(controlTransition(ctx(control),event).reply,{error:'recovery_control_request_expired'});
 assert.deepEqual(controlTransition(ctx(at('draining')),request('explode')).reply,{error:'recovery_control_action_invalid'});
 assert.deepEqual(controlTransition(ctx(at('draining')),request('status')),{control:at('draining'),reply:'snapshot',commands:[]});
});

test('cancel, stopAfterDrain and restart follow the state table',()=>{
 const rows=[
  // [action, state, context extra, next state, commands, error]
  ['cancel','draining',{},'cancelled',[{type:'send',action:'cancel',onFail:{control:{state:'draining'},error:'recovery_control_worker_unavailable'}}]],
  ['cancel','ready',{worker:false},'cancelled',[]],
  ['cancel','ready',{worker:false,resumeCrash:true},'cancelled',[{type:'start'}]],
  ['cancel','off',{worker:false,mode:'off'},'cancelled',[]],
  ['cancel','cancelled',{},'cancelled',[]],
  ['cancel','stopping',{},'stopping',[],'recovery_control_cannot_cancel'],
  ['stopAfterDrain','ready',{},'stopping',[{type:'send',action:'stop',onFail:{control:{state:'failed'},error:'recovery_control_worker_unavailable'}},{type:'awaitExit'}]],
  ['stopAfterDrain','ready',{worker:false},'stopped',[]],
  ['stopAfterDrain','off',{worker:false,mode:'off'},'stopped',[]],
  ['stopAfterDrain','stopping',{},'stopping',[{type:'awaitExit'}]],
  ['stopAfterDrain','stopped',{worker:false},'stopped',[]],
  ['stopAfterDrain','draining',{},'draining',[],'recovery_control_not_drained'],
  ['restart','stopped',{worker:false},'starting',[{type:'start'}]],
  ['restart','stopped',{worker:false,mode:'off'},'off',[]],
  ['restart','running',{},'running',[]],
  ['restart','starting',{},'starting',[]],
  ['restart','ready',{},'ready',[],'recovery_control_not_stopped'],
 ];
 for(const [action,state,extra,next,commands,error] of rows){
  const result=controlTransition(ctx(at(state),extra),request(action)),name=`${action} from ${state} ${JSON.stringify(extra)}`;
  assert.equal(result.control.state,next,name);assert.deepEqual(result.commands,commands,name);assert.deepEqual(result.reply,error?{error}:'snapshot',name);
 }
});

test('worker events and a worker exit end or advance only the matching request',()=>{
 assert.equal(controlTransition(ctx(at('starting')),{type:'worker',event:'ready'}).control.state,'running');
 assert.equal(controlTransition(ctx(at('draining')),{type:'worker',event:'ready'}).control.state,'draining');
 assert.equal(controlTransition(ctx(at('draining')),{type:'worker',event:'drained',id:'a'}).control.state,'ready');
 assert.equal(controlTransition(ctx(at('draining')),{type:'worker',event:'drained',id:'b'}).control.state,'draining');
 assert.equal(controlTransition(ctx(null),{type:'worker',event:'drained',id:'a'}).control,null);
 assert.deepEqual(controlTransition(ctx(at('stopping')),{type:'exit'}),{control:{id:'a',state:'stopped',reason:null},commands:[],intentional:true});
 for(const state of ['draining','ready','starting'])assert.deepEqual(controlTransition(ctx(at(state)),{type:'exit'}),{control:{id:'a',state:'failed',reason:'worker-exited'},commands:[],intentional:false},state);
 for(const control of [null,at('running'),at('cancelled'),at('stopped')])assert.equal(controlTransition(ctx(control),{type:'exit'}).intentional,undefined,JSON.stringify(control));
});

// The supervisor's executor: effects in order, and a failed worker send handled as the transition says.
async function execute(context,event,{sendOk=true}={}){
 const log=[];let control=context.control;
 const reply=await runControlCommands(controlTransition(context,event),{send:action=>{log.push('send:'+action);return sendOk},start:()=>log.push('start'),clearRestart:()=>log.push('clearRestart'),markUsed:id=>log.push('markUsed:'+id),awaitExit:async()=>{log.push('awaitExit')},setControl:value=>{control=value},snapshot:()=>({...control,session})});
 return {reply,control,log};
}
test('the executor runs commands in order and applies the failure handling of a worker send',async()=>{
 assert.deepEqual(await execute(ctx(),request('requestDrain')),{reply:{...at('draining'),session},control:at('draining'),log:['markUsed:a','clearRestart','send:drain']});
 assert.deepEqual(await execute(ctx(),request('requestDrain'),{sendOk:false}),{reply:{id:'a',state:'failed',reason:'worker-unavailable',session},control:{id:'a',state:'failed',reason:'worker-unavailable'},log:['markUsed:a','clearRestart','send:drain']});
 assert.deepEqual(await execute(ctx(at('draining')),request('cancel'),{sendOk:false}),{reply:{error:'recovery_control_worker_unavailable'},control:at('draining'),log:['send:cancel']},'a failed cancel keeps the request');
 assert.deepEqual(await execute(ctx(at('ready')),request('stopAfterDrain'),{sendOk:false}),{reply:{error:'recovery_control_worker_unavailable'},control:at('failed'),log:['send:stop']},'no wait for an exit after a failed stop');
 assert.deepEqual((await execute(ctx(at('ready')),request('stopAfterDrain'))).log,['send:stop','awaitExit']);
 assert.deepEqual(await execute(ctx(at('ready')),request('restart')),{reply:{error:'recovery_control_not_stopped'},control:at('ready'),log:[]});
});
test('after a failed worker send no further command runs',async()=>{
 const log=[];let control=null;
 const step={control:at('draining'),reply:'snapshot',commands:[{type:'send',action:'drain',onFail:{control:{state:'failed'}}},{type:'start'},{type:'awaitExit'}]};
 const reply=await runControlCommands(step,{send:()=>false,start:()=>log.push('start'),clearRestart:()=>{},markUsed:()=>{},awaitExit:()=>{log.push('awaitExit')},setControl:value=>{control=value},snapshot:()=>({...control})});
 assert.deepEqual([reply,log],[at('failed'),[]]);
});
