// In-memory login state: session expiry and the per-address login rate limit.
export const SESSION_TTL_MS=30*86400000;
export const AUTH_WINDOW_MS=60000;
export const AUTH_MAX_ATTEMPTS=12;

// Removes sessions whose expiry has passed (or is not a number). Returns how many were removed.
export function pruneSessions(sessions,now=Date.now()){
 let removed=0;
 for(const [key,expires] of sessions)if(!(Number(expires)>now)){sessions.delete(key);removed++}
 return removed;
}

// Drops rate-limit entries whose window has ended; a new attempt starts a fresh window anyway.
export function pruneAuthAttempts(attempts,now=Date.now()){
 let removed=0;
 for(const [ip,attempt] of attempts)if(!(now-attempt.at<=AUTH_WINDOW_MS)){attempts.delete(ip);removed++}
 return removed;
}

// Counts one login attempt for the address; false means the limit for the current window is exceeded.
export function registerAuthAttempt(attempts,ip,now=Date.now()){
 const attempt=attempts.get(ip)||{at:now,count:0};
 if(now-attempt.at>AUTH_WINDOW_MS){attempt.at=now;attempt.count=0}
 attempt.count++;attempts.set(ip,attempt);
 return attempt.count<=AUTH_MAX_ATTEMPTS;
}
