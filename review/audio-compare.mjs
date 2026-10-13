import {previewErrors} from './preview-diagnostics.mjs';
import {spawnPreview} from './preview-process.mjs';
export function envelope(pcm){const out=[];for(let i=0;i+160<=pcm.length;i+=160){let sum=0;for(let j=i;j<i+160;j+=2){const v=pcm.readInt16LE(j)/32768;sum+=v*v}out.push(Math.sqrt(sum/80))}return out}
export function alignment(a,b){
 const n=Math.min(a.length,b.length);if(n<400)return {reliable:false,reason:'Příliš krátký úsek.'};
 const scores=[];for(let lag=-100;lag<=100;lag++){let x=0,y=0,xx=0,yy=0,xy=0,k=0;for(let i=100;i<n-100;i++){const u=a[i],v=b[i+lag];x+=u;y+=v;xx+=u*u;yy+=v*v;xy+=u*v;k++}const den=Math.sqrt((xx-x*x/k)*(yy-y*y/k));scores.push({lag,score:den>1e-9?(xy-x*y/k)/den:0})}
 scores.sort((a,b)=>b.score-a.score);const best=scores[0],other=scores.find(s=>Math.abs(s.lag-best.lag)>5);const reliable=best.score>=.85&&best.score-(other?.score||0)>=.03&&Math.abs(best.lag)<100;
 return {reliable,offsetMs:reliable?best.lag*10:null,correlation:best.score,reason:reliable?'Odhad ze zvukové obálky; kladně = výstup má zvuk později.':'Ticho, odlišná stopa nebo nejednoznačný průběh — posun nelze spolehlivě určit.'};
}
export function extractAudio(exe,file,index,seconds,startTime=0,options={}){
 if(!Number.isInteger(index)||index<0||!Number.isFinite(seconds)||seconds<0||!Number.isFinite(startTime))throw Error('Neplatné parametry zvuku.');
 const start=seconds+startTime;
 return new Promise((resolve,reject)=>{const p=spawnPreview(exe,['-v','error','-nostdin','-threads','2','-copyts','-ss',String(Math.max(0,seconds-2)),'-i',file,'-map','0:'+index,'-vn','-sn','-af',`atrim=start=${start}:end=${start+12},asetpts=PTS-(${start})/TB,aresample=8000:async=1:first_pts=0`,'-ac','1','-ar','8000','-t','12','-f','s16le','pipe:1'],options);const chunks=[];let size=0,err='',failure;const timer=setTimeout(()=>{failure=Error('Příprava zvuku překročila 60 sekund.');p.kill('SIGKILL')},60000);p.stdout.on('data',b=>{size+=b.length;if(size>240000){failure=Error('Příliš velký zvukový úsek.');p.kill('SIGKILL')}else chunks.push(b)});p.stderr.on('data',b=>{err=(err+b).slice(-16384)});p.on('error',e=>{clearTimeout(timer);reject(e)});p.on('close',code=>{clearTimeout(timer);if(failure)return reject(failure);if(code||previewErrors(err).trim())return reject(Error('Nelze připravit zvuk: '+err));const pcm=Buffer.concat(chunks);if(pcm.length<192000*.95||pcm.length>192000*1.01||pcm.length%2)return reject(Error('Neúplný zvukový úsek.'));resolve(envelope(pcm))})});
}
