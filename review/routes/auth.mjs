import crypto from 'node:crypto';
import {hash} from '../core.mjs';
import {SESSION_TTL_MS,pruneSessions,pruneAuthAttempts,registerAuthAttempt} from '../auth-state.mjs';
import {body,respond,apiError} from './http.mjs';

// Login is the only unauthenticated API route. Returns true when it answered the request.
export async function login(ctx,req,res,url){
 if(url.pathname!=='/api/login'||req.method!=='POST')return false;
 const now=Date.now();pruneAuthAttempts(ctx.authAttempts,now);if(!registerAuthAttempt(ctx.authAttempts,req.socket.remoteAddress,now)){respond(res,429,apiError('login_rate_limited'));return true}
 const b=await body(req);
 if(hash(String(b.key||''))!==hash(ctx.KEY)){respond(res,401,apiError('access_key_invalid'));return true}
 const token=crypto.randomBytes(32).toString('base64url');pruneSessions(ctx.sessions);ctx.sessions.set(hash(token),Date.now()+SESSION_TTL_MS);ctx.state.sessions=Object.fromEntries(ctx.sessions);await ctx.save();
 respond(res,200,{ok:true},{'set-cookie':`review_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`});return true;
}

export function authenticated(ctx,req){
 const cookie=/review_session=([^;]+)/.exec(req.headers.cookie||'')?.[1];
 return Boolean(cookie&&(ctx.sessions.get(hash(cookie))||0)>Date.now());
}
