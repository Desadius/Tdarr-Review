import fs from 'node:fs/promises';
import path from 'node:path';

// The browser UI. Only these files under public/ are served.
const assets={'/review-workflow.js':['review-workflow.js','text/javascript; charset=utf-8'],'/av-player.js':['av-player.js','text/javascript; charset=utf-8'],'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/review-model.js':['review-model.js','text/javascript; charset=utf-8'],'/i18n.js':['i18n.js','text/javascript; charset=utf-8'],'/messages.en.js':['messages.en.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/favicon.svg':['favicon.svg','image/svg+xml']};
export async function staticRoutes(ctx,req,res,url){
 if(req.method!=='GET'||!assets[url.pathname])return false;
 const [file,mime]=assets[url.pathname];res.writeHead(200,{'content-type':mime,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'referrer-policy':'no-referrer'});res.end(await fs.readFile(path.join(ctx.ROOT,'public',file)));return true;
}
