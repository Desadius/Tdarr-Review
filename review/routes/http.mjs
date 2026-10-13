// Shared request/response helpers for the Review route modules.
export async function body(req){let b='';for await(const chunk of req){b+=chunk;if(b.length>32768)throw new Error('Požadavek je příliš velký.')}return JSON.parse(b||'{}')}
export function respond(res,status,data,headers={}){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers});res.end(JSON.stringify(data))}
// Route handlers return true once they have answered; reply() responds and returns true.
export const reply=(res,status,data,headers)=>(respond(res,status,data,headers),true);
