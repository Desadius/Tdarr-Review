import test from 'node:test';
import assert from 'node:assert/strict';
import {createTdarrFileState,HOLD_FOREVER,QUEUE_ACCEPTED,isHeld} from './tdarr-file-state.mjs';

const file='/media/movies/Film/Film.mkv',libraryId='library';
// A fake Tdarr with one row; ignoreWrites models an unacknowledged write.
function fakeTdarr(row,{ignoreWrites=false}={}){
 const calls=[];
 const tdarr=async(route,body)=>{calls.push({route,body});if(route==='/api/v2/cruddb')return typeof row==='object'&&row?structuredClone(row):row;if(route==='/api/v2/bulk-update-files'&&!ignoreWrites&&row&&typeof row==='object')Object.assign(row,body.updatedObj);return 'OK'};
 return {tdarr,calls};
}

test('read returns the bound row, null for an empty answer and refuses another file, library or shape',async()=>{
 const row={_id:file,DB:libraryId,TranscodeDecisionMaker:'Queued'};
 assert.deepEqual(await createTdarrFileState(fakeTdarr(row).tdarr,{libraryId}).read(file),row);
 for(const empty of ['',null])assert.equal(await createTdarrFileState(fakeTdarr(empty).tdarr,{libraryId}).read(file),null);
 for(const wrong of [{...row,_id:'/media/movies/other.mkv'},{...row,DB:'other'},[],'OK',undefined,7])
  await assert.rejects(createTdarrFileState(fakeTdarr(wrong).tdarr,{libraryId}).read(file),{code:'TDARR_FILE_BINDING'},JSON.stringify(wrong));
 assert.deepEqual(await createTdarrFileState(fakeTdarr({...row,DB:'any'}).tdarr).read(file),{...row,DB:'any'},'without a configured library only the file is bound');
 const {tdarr,calls}=fakeTdarr(row);await createTdarrFileState(tdarr).read(file);assert.deepEqual(calls,[{route:'/api/v2/cruddb',body:{collection:'FileJSONDB',mode:'getById',docID:file}}]);
});

test('hold writes once, reads back and requires exactly Hold with the requested deadline',async()=>{
 const row={_id:file,DB:libraryId,TranscodeDecisionMaker:'Transcode error'},{tdarr,calls}=fakeTdarr(row);
 const held=await createTdarrFileState(tdarr,{libraryId}).hold(file,HOLD_FOREVER);
 assert.deepEqual([held.TranscodeDecisionMaker,held.holdUntil],['Hold',HOLD_FOREVER]);
 assert.deepEqual(calls.map(call=>call.route),['/api/v2/bulk-update-files','/api/v2/cruddb']);
 assert.deepEqual(calls[0].body,{fileIds:[file],updatedObj:{TranscodeDecisionMaker:'Hold',holdUntil:HOLD_FOREVER}});
 const until=Date.now()+30*86400000;assert.equal((await createTdarrFileState(fakeTdarr({...row}).tdarr).hold(file,until)).holdUntil,until);
 assert.equal(isHeld({TranscodeDecisionMaker:'Hold',holdUntil:String(HOLD_FOREVER)},HOLD_FOREVER),true,'Tdarr may report the deadline as text');
 for(const other of [{TranscodeDecisionMaker:'Hold',holdUntil:HOLD_FOREVER-1},{TranscodeDecisionMaker:'Queued',holdUntil:HOLD_FOREVER},null])assert.equal(isHeld(other,HOLD_FOREVER),false);
});

test('an unacknowledged, missing or foreign Hold is never reported as held',async()=>{
 const row={_id:file,DB:libraryId,TranscodeDecisionMaker:'Transcode error'};
 await assert.rejects(createTdarrFileState(fakeTdarr(row,{ignoreWrites:true}).tdarr,{libraryId}).hold(file,HOLD_FOREVER,'custom message'),{code:'TDARR_HOLD_UNCONFIRMED',message:'custom message'});
 await assert.rejects(createTdarrFileState(fakeTdarr(null).tdarr,{libraryId}).hold(file,HOLD_FOREVER),{code:'TDARR_HOLD_UNCONFIRMED'});
 await assert.rejects(createTdarrFileState(fakeTdarr({...row,DB:'other'}).tdarr,{libraryId}).hold(file,HOLD_FOREVER),{code:'TDARR_FILE_BINDING'});
 const shorter={_id:file,DB:libraryId,TranscodeDecisionMaker:'Hold',holdUntil:5};const {tdarr}=fakeTdarr(shorter,{ignoreWrites:true});
 await assert.rejects(createTdarrFileState(tdarr,{libraryId}).hold(file,HOLD_FOREVER),{code:'TDARR_HOLD_UNCONFIRMED'},'an older, shorter Hold is not this Hold');
 for(const until of [0,-1,1.5,NaN,HOLD_FOREVER+1,'1']){const fake=fakeTdarr({...row});await assert.rejects(createTdarrFileState(fake.tdarr).hold(file,until),{code:'TDARR_HOLD_INVALID'});assert.deepEqual(fake.calls,[],'an invalid deadline writes nothing')}
});

test('queue writes Queued without a deadline and returns the row read afterwards',async()=>{
 const row={_id:file,DB:libraryId,TranscodeDecisionMaker:'Hold',holdUntil:HOLD_FOREVER},{tdarr,calls}=fakeTdarr(row);
 const after=await createTdarrFileState(tdarr,{libraryId}).queue(file);
 assert.deepEqual([after.TranscodeDecisionMaker,after.holdUntil],['Queued',0]);assert.ok(QUEUE_ACCEPTED.includes(after.TranscodeDecisionMaker));
 assert.deepEqual(calls.map(call=>call.route),['/api/v2/bulk-update-files','/api/v2/cruddb']);
 assert.equal((await createTdarrFileState(fakeTdarr({_id:file,DB:libraryId,TranscodeDecisionMaker:'Hold',holdUntil:HOLD_FOREVER},{ignoreWrites:true}).tdarr,{libraryId}).queue(file)).TranscodeDecisionMaker,'Hold','an ignored write is visible to the caller');
});
