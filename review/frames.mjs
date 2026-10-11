import {spawn} from 'node:child_process';
export function extractFrame(exe,file,seconds,hdr=false){
 if(!Number.isFinite(seconds)||seconds<0)throw Error('Invalid time');
 const filter=hdr?'zscale=pin=bt2020:tin=smpte2084:min=bt2020nc:rin=limited:t=linear:p=bt2020:m=gbr:r=full:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:peak=10:desat=0,zscale=t=iec61966-2-1:m=gbr:r=full,format=rgb24':'format=rgb24';
 return new Promise((resolve,reject)=>{
  const child=spawn(exe,['-v','error','-nostdin','-threads','2','-ss',String(seconds),'-i',file,'-map','0:V:0','-frames:v','1','-an','-sn','-vf',filter,'-filter_threads','1','-threads','1','-c:v','png','-f','image2pipe','pipe:1'],{stdio:['ignore','pipe','pipe']});
  const chunks=[];let size=0,err='',failure;
  const stop=message=>{failure=Error(message);child.kill('SIGKILL')};
  const timer=setTimeout(()=>stop('Příprava snímku překročila 60 sekund. Zkus jiný čas.'),60000);
  child.stdout.on('data',b=>{size+=b.length;if(size>40*1024*1024)stop('Snímek je příliš velký.');else chunks.push(b)});
  child.stderr.on('data',b=>{err=(err+b).slice(-2000)});
  child.on('error',e=>{clearTimeout(timer);reject(e)});
  child.on('close',code=>{clearTimeout(timer);const png=Buffer.concat(chunks);if(failure)return reject(failure);if(code||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')return reject(Error('Nelze vytvořit snímek: '+err));resolve(png)});
 });
}
