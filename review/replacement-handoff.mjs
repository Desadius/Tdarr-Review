export async function ensureHandoff({tdarr,file,libraryId}){
 const read=async()=>{const r=await tdarr('/api/v2/cruddb',{collection:'FileJSONDB',mode:'getById',docID:file});if(r===''||r===null)return null;if(!r||typeof r!=='object'||Array.isArray(r)||r._id!==file||r.DB!==libraryId)throw Error('Invalid Tdarr file binding');return r;};
 let row=await read();
 if(!row){await tdarr('/api/v2/rescan-file',{_id:file,DB:libraryId});row=await read();if(!row)throw Error('Tdarr scan pending; handoff will be checked again.');}
 if(['Queued','Transcoding','Transcode success','Transcode error','Not required'].includes(row.TranscodeDecisionMaker))return row.TranscodeDecisionMaker;
 if(row.TranscodeDecisionMaker!=='Hold')throw Error('Unrecognized Tdarr state; handoff requires inspection.');
 await tdarr('/api/v2/bulk-update-files',{fileIds:[file],updatedObj:{TranscodeDecisionMaker:'Queued',holdUntil:0}});
 row=await read();if(!row||!['Queued','Transcoding','Transcode success','Transcode error','Not required'].includes(row.TranscodeDecisionMaker))throw Error('Queue acknowledgement pending; handoff will be checked again.');return row.TranscodeDecisionMaker;
}
