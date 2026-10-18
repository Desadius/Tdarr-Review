import {spawn} from 'node:child_process';
import {lowPriorityCommand} from './low-priority.mjs';

// Background previews use the same bounded decoders; priority is not a quality setting.
export function spawnPreview(exe,args,{signal,background=false,input=false}={}){
 const [command,argv]=lowPriorityCommand(exe,args,background&&process.platform==='linux');
 return spawn(command,argv,{stdio:[input?'pipe':'ignore','pipe','pipe'],windowsHide:true,signal,killSignal:'SIGKILL'});
}
