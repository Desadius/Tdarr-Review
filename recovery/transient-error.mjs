// @ts-check
// A read that failed only because Radarr or Tdarr was briefly unreachable. Such a failure proves nothing
// about the film, so a read-only step may simply try again on the next poll instead of going manual.
const CODES=new Set(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EAI_AGAIN','ENOTFOUND','EHOSTUNREACH','ENETUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET']);
const MESSAGES=new Set(['fetch failed','The operation was aborted due to timeout','This operation was aborted']);

/** Whether an error is a transient network failure of an HTTP call. */
export function isTransientError(error){
 if(!error||typeof error!=='object')return false;
 const e=/** @type {any} */(error);
 return e.name==='TimeoutError'||CODES.has(e.code)||CODES.has(e.cause?.code)||MESSAGES.has(e.message);
}
/** Whether a saved case message is exactly such a failure. */
export const isTransientMessage=message=>typeof message==='string'&&MESSAGES.has(message);

// How long a transient read failure stays out of the published case error: a brief outage of Radarr or
// Tdarr is retried on every poll and is not a reason to ask the user for anything.
export const TRANSIENT_GRACE_MS=3600000;

/** Records a failed read on a case; a transient failure keeps the time it began. */
export function noteObservationError(c,error,now=Date.now()){
 c.observationError=error instanceof Error?error.message:String(error);
 if(isTransientError(error))c.observationErrorSince??=new Date(now).toISOString();else delete c.observationErrorSince;
}
/** Clears the case's read failure after a successful observation. */
export function clearObservationError(c){delete c.observationError;delete c.observationErrorSince;}
/** The read failure to publish: a transient one only after it has lasted the grace period. */
export function publishedObservationError(c,now=Date.now()){
 if(!c?.observationError)return null;
 const since=Date.parse(c.observationErrorSince);
 return isTransientMessage(c.observationError)&&Number.isFinite(since)&&now-since<TRANSIENT_GRACE_MS?null:c.observationError;
}
