import {reply,apiError} from './http.mjs';

// Read-only TV discovery (#271). There is deliberately no other method and no per-result route here:
// a TV result cannot be approved, rejected, replaced or retained.
export async function tvRoutes(ctx,req,res,url){
 if(req.method!=='GET'||!['/api/tv','/api/tv/status'].includes(url.pathname))return false;
 if(url.pathname==='/api/tv/status')return reply(res,200,{mode:ctx.tvDiscovery.mode()});
 const keys=[...url.searchParams.keys()];
 if(keys.some(key=>key!=='refresh')||url.searchParams.getAll('refresh').length>1||!['',null,'1'].includes(url.searchParams.get('refresh')))return reply(res,400,apiError('tv_invalid_request'));
 return reply(res,200,await ctx.tvDiscovery.result({force:url.searchParams.get('refresh')==='1'}));
}
