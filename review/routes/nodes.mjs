import {body,reply,apiError} from './http.mjs';

// Pending Tdarr node restores: the user may keep a node paused that they paused themselves.
export async function nodeRoutes(ctx,req,res,url,request){
 if(url.pathname!=='/api/node-restores/keep'||req.method!=='POST')return false;
 const b=await body(req);
 if(b.confirm!==true||typeof b.name!=='string'||!b.name)return reply(res,400,apiError('node_keep_confirm_required'));
 if(ctx.busyFor('keepPaused',request.mutation))return reply(res,409,apiError('busy_retry'));
 if(!await ctx.keepNodePaused(b.name))return reply(res,409,apiError('node_restore_unknown'));
 return reply(res,200,{ok:true,pendingRestores:ctx.pendingRestores()});
}
