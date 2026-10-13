export const AUTH_ATTEMPT_WINDOW_MS=60000;

// Keep the persisted token hashes and per-address login window bounded by time.
// Invalid stored expiries fail closed rather than becoming immortal entries.
export function pruneAuthentication(sessions,attempts,now=Date.now()){
  let sessionsRemoved=0,attemptsRemoved=0;
  for(const [token,expires] of sessions){
    if(!Number.isFinite(expires)||expires<=now){sessions.delete(token);sessionsRemoved++;}
  }
  for(const [address,attempt] of attempts){
    if(!Number.isFinite(attempt?.at)||now-attempt.at>=AUTH_ATTEMPT_WINDOW_MS){attempts.delete(address);attemptsRemoved++;}
  }
  return {sessionsRemoved,attemptsRemoved};
}

export function allowAuthenticationAttempt(attempts,address,now=Date.now()){
  let attempt=attempts.get(address);
  if(!attempt||now-attempt.at>=AUTH_ATTEMPT_WINDOW_MS)attempt={at:now,count:0};
  attempt.count++;
  attempts.set(address,attempt);
  return attempt.count<=12;
}
