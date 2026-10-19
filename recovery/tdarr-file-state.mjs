// The one reader and writer of a Tdarr file's transcode decision, shared by Recovery and Review (#196).
// Every write is read back: a Hold counts only when Tdarr reports exactly Hold with the requested
// holdUntil, and a row must belong to the expected file (and library, when one is configured).
// Callers persist their intent before writing and never replay an unconfirmed write blindly.
export const HOLD_FOREVER=253402300799000;
export const QUEUE_ACCEPTED=Object.freeze(['Queued','Transcoding','Transcode success','Transcode error','Not required']);
const failure=(code,message)=>Object.assign(Error(message),{code});
export const isHeld=(row,until)=>row?.TranscodeDecisionMaker==='Hold'&&Number(row.holdUntil)===until;

export function createTdarrFileState(tdarr,{libraryId}={}){
 if(typeof tdarr!=='function')throw TypeError('Tdarr client required');
 // A missing row is null; a row for another file or library is refused, never trusted.
 async function read(file){
  const row=await tdarr('/api/v2/cruddb',{collection:'FileJSONDB',mode:'getById',docID:file});
  // Only Tdarr's empty answers mean "no such row"; anything else unexpected is refused.
  if(row===''||row===null)return null;
  if(!row||typeof row!=='object'||Array.isArray(row)||row._id!==file||libraryId!==undefined&&row.DB!==libraryId)throw failure('TDARR_FILE_BINDING','Tdarr file entry does not match the expected file and library');
  return row;
 }
 async function hold(file,until,message='Tdarr Hold was not confirmed; inspect before retry'){
  if(!Number.isSafeInteger(until)||until<=0||until>HOLD_FOREVER)throw failure('TDARR_HOLD_INVALID','Invalid Tdarr Hold deadline');
  await tdarr('/api/v2/bulk-update-files',{fileIds:[file],updatedObj:{TranscodeDecisionMaker:'Hold',holdUntil:until}});
  const row=await read(file);
  if(!isHeld(row,until))throw failure('TDARR_HOLD_UNCONFIRMED',message);
  return row;
 }
 // Returns the row read after the write, or null; the caller decides whether its state is accepted.
 async function queue(file){
  await tdarr('/api/v2/bulk-update-files',{fileIds:[file],updatedObj:{TranscodeDecisionMaker:'Queued',holdUntil:0}});
  return read(file);
 }
 return {read,hold,queue};
}
