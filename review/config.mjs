import fs from 'node:fs/promises';
import path from 'node:path';
export function defaults(e=process.env){return {label:'Tdarr Review',tdarrUrl:e.TDARR_URL||'http://tdarr:8266',publicOrigin:e.PUBLIC_ORIGIN||'http://'+(e.PUBLIC_HOST||'localhost:8270'),mediaRoot:e.MEDIA_ROOT||'/media',reviewRoot:e.REVIEW_ROOT||'/review',database:e.TDARR_DB||'/tdarr/SQL/database.db',ffprobe:e.FFPROBE||'/app/Tdarr_Node/assets/app/ffmpeg/linux_x64/ffprobe',ffmpeg:e.FFMPEG||'/app/Tdarr_Node/assets/app/ffmpeg/linux_x64/ffmpeg',sourceRoots:['/media'],tdarrReviewRoot:'/review',reviewPrefixes:[],libraryId:''}}
export function validate(c){
 const keys=Object.keys(defaults({}));if(!c||keys.some(k=>!(k in c))||Object.keys(c).some(k=>!keys.includes(k)))throw Error('Neúplná nebo neznámá pole nastavení.');
 for(const k of keys.filter(k=>!['sourceRoots','reviewPrefixes'].includes(k)))if(typeof c[k]!=='string'||c[k].length>2048)throw Error('Neplatné pole '+k);
 if(!c.label.trim()||c.label.length>100)throw Error('Vyplň název instalace.');
 for(const k of ['tdarrUrl','publicOrigin']){const u=new URL(c[k]);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error(k+': použij pouze http(s) adresu a port.');c[k]=u.origin;}
 for(const k of ['mediaRoot','reviewRoot','database','ffprobe','ffmpeg','tdarrReviewRoot'])if(!path.posix.isAbsolute(c[k])||c[k].includes('\\')||c[k].split('/').includes('..')||c[k]==='/')throw Error('Vyžadována absolutní cesta v kontejneru: '+k);
 for(const k of ['sourceRoots','reviewPrefixes'])if(!Array.isArray(c[k])||c[k].length>20||c[k].some(v=>typeof v!=='string'||!v||v.length>1024||v.includes('\\')||v.split('/').some(x=>x==='..'||x==='.')||(k==='sourceRoots'?!v.startsWith('/')||v==='/':v.includes('/'))))throw Error('Neplatný seznam '+k);
 if(!c.sourceRoots.length)throw Error('Vyplň alespoň jednu zdrojovou cestu Tdarru.');
 for(const k of ['mediaRoot','reviewRoot','tdarrReviewRoot'])c[k]=c[k].replace(/\/+$/,'');c.sourceRoots=c.sourceRoots.map(x=>x.replace(/\/+$/,''));
 if(c.mediaRoot===c.reviewRoot||c.mediaRoot.startsWith(c.reviewRoot+'/')||c.reviewRoot.startsWith(c.mediaRoot+'/'))throw Error('Originály a review musí být oddělené složky.');return c;
}
export async function checkPaths(c){
 const [a,b]=await Promise.all([fs.realpath(c.mediaRoot),fs.realpath(c.reviewRoot)]);
 if(a===b||a.startsWith(b+'/')||b.startsWith(a+'/'))throw Error('Složky se fyzicky překrývají.');
 for(const k of ['mediaRoot','reviewRoot']){if(!(await fs.stat(c[k])).isDirectory())throw Error(k+' není složka');await fs.access(c[k],fs.constants.R_OK|fs.constants.W_OK)}
 for(const k of ['database','ffprobe','ffmpeg']){if(!(await fs.stat(c[k])).isFile())throw Error(k+' není soubor');await fs.access(c[k],k==='database'?fs.constants.R_OK:fs.constants.X_OK)}
}
export function mapReview(relative,prefixes){const bits=relative.split('/');if(prefixes.includes(bits[0]))bits.shift();if(bits.length<2||bits.some(x=>!x||x==='.'||x==='..')||relative.includes('\\')||!/\.mkv$/i.test(bits.at(-1)))return null;return bits.join('/')}
