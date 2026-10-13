import {spawn} from 'node:child_process';

// Background previews use the same bounded decoders; priority is not a quality setting.
export function spawnPreview(exe,args,{signal,background=false}={}){
 const lower=background&&process.platform==='linux';
 return spawn(lower?'/usr/bin/ionice':exe,lower?['-c','2','-n','7','/usr/bin/nice','-n','19',exe,...args]:args,{stdio:['ignore','pipe','pipe'],windowsHide:true,signal,killSignal:'SIGKILL'});
}
