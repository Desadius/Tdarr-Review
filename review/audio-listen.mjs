import {withMpeg2Initialization} from './mpeg2-initialization.mjs';
import {previewErrors} from './preview-diagnostics.mjs';
import {spawnPreview} from './preview-process.mjs';
export function listeningArgs(file,index,seconds,startTime=0){
 if(!Number.isInteger(index)||index<0||!Number.isFinite(seconds)||seconds<0||!Number.isFinite(startTime))throw Error('Neplatný úsek nebo stopa.');
 const start=seconds+startTime;
 return ['-v','error','-nostdin','-threads','2','-copyts','-ss',String(Math.max(0,seconds-2)),'-i',file,'-map','0:'+index,'-vn','-sn','-af',`atrim=start=${start}:end=${start+12},asetpts=PTS-(${start})/TB,aresample=48000:async=1:first_pts=0`,'-ac','1','-ar','48000','-t','12','-f','f32le','pipe:1'];
}
export function encodeListeningPCM(buffer){
 const expected=48000*12*4;if(buffer.length<expected*.95||buffer.length>expected||buffer.length%4)throw Error('Neúplný zvukový úsek.');
 for(let i=0;i<buffer.length;i+=4)if(!Number.isFinite(buffer.readFloatLE(i)))throw Error('Neplatné zvukové vzorky.');
 return {pcm:buffer.toString('base64'),sampleRate:48000,frames:buffer.length/4};
}
function extractListeningAudioOnce(exe,file,index,seconds,startTime=0,options={}){
 const args=listeningArgs(file,index,seconds,startTime);
 return new Promise((resolve,reject)=>{const p=spawnPreview(exe,args,options);const chunks=[];let bytes=0,stderr='',failure;
 const timer=setTimeout(()=>{failure=Error('Příprava poslechu překročila 60 sekund.');p.kill('SIGKILL')},options.timeoutMs??60000);
 p.stdout.on('data',b=>{bytes+=b.length;if(bytes>48000*12*4){failure=Error('Příliš dlouhý zvukový úsek.');p.kill('SIGKILL')}else chunks.push(b)});
 p.stderr.on('data',b=>{stderr=(stderr+b).slice(-16384)});p.on('error',e=>{failure=e;});
 p.on('close',code=>{clearTimeout(timer);try{if(failure)throw failure;if(code||previewErrors(stderr).trim())throw Object.assign(Error('Poslech nelze připravit: '+stderr),{previewExitCode:code,previewDiagnostics:stderr});resolve(encodeListeningPCM(Buffer.concat(chunks)))}catch(e){reject(e)}});
 });
}

export function extractListeningAudio(exe,file,index,seconds,startTime=0,options={}){
 return withMpeg2Initialization(file,(input,timeoutMs)=>extractListeningAudioOnce(exe,input,index,seconds,startTime,{...options,timeoutMs}),{signal:options.signal,budgetMs:60000});
}
