// Backoff for retrying a failed restore of Tdarr nodes that Review paused.
export const RESUME_RETRY_TICK_MS=15000;
export const RESUME_RETRY_MAX_MS=600000;
export function resumeRetryDelay(failures){
 return Math.min(RESUME_RETRY_TICK_MS*2**Math.max(0,Math.min(failures,16)),RESUME_RETRY_MAX_MS);
}
