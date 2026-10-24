import fs from 'node:fs/promises';
import path from 'node:path';

// The browser UI. Only these files under public/ are served.
const assets={'/shared-settings-view.js':['shared-settings-view.js','text/javascript; charset=utf-8'],'/shared-settings-messages.js':['shared-settings-messages.js','text/javascript; charset=utf-8'],'/review-workflow.js':['review-workflow.js','text/javascript; charset=utf-8'],'/review-rules.js':['review-rules.js','text/javascript; charset=utf-8'],'/av-player.js':['av-player.js','text/javascript; charset=utf-8'],'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/ui-kit.js':['ui-kit.js','text/javascript; charset=utf-8'],'/recovery-view.js':['recovery-view.js','text/javascript; charset=utf-8'],'/installed-assessment-view.js':['installed-assessment-view.js','text/javascript; charset=utf-8'],'/comparison.js':['comparison.js','text/javascript; charset=utf-8'],'/settings-dialogs.js':['settings-dialogs.js','text/javascript; charset=utf-8'],'/quarantine.js':['quarantine.js','text/javascript; charset=utf-8'],'/statistics.js':['statistics.js','text/javascript; charset=utf-8'],'/review-model.js':['review-model.js','text/javascript; charset=utf-8'],'/i18n.js':['i18n.js','text/javascript; charset=utf-8'],'/error-messages.js':['error-messages.js','text/javascript; charset=utf-8'],'/messages.en.js':['messages.en.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/favicon.svg':['favicon.svg','image/svg+xml']};
for(const file of ['guided-player.js','player-controls.js','guided-preparation.js','guided-comparison.js','continuous-review.js','guided-messages.js'])assets['/'+file]=[file,'text/javascript; charset=utf-8'];
assets['/player-controls.css']=['player-controls.css','text/css; charset=utf-8'];
export async function staticRoutes(ctx,req,res,url){
 if(req.method!=='GET'||!assets[url.pathname])return false;
 const [file,mime]=assets[url.pathname];let data=await fs.readFile(path.join(ctx.ROOT,'public',file));
 // Every module URL carries the app version from one source, so a module is never evaluated twice under two URLs.
 if(!mime.startsWith('image/'))data=Buffer.from(data.toString('utf8').replaceAll('?v=__APP_VERSION__','?v='+encodeURIComponent(ctx.APP_VERSION)));
 res.writeHead(200,{'content-type':mime,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'referrer-policy':'no-referrer'});res.end(data);return true;
}
