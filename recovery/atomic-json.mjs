import fs from 'node:fs/promises';
import path from 'node:path';
export async function atomicJson(file,value,mode=0o600){
 if(mode!==0o600&&mode!==0o644)throw Error('Unsupported JSON permissions');
 const t=file+'.tmp',h=await fs.open(t,'w',0o600);
 try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.chmod(mode);await h.sync();}finally{await h.close();}
 await fs.rename(t,file);
 const d=await fs.open(path.dirname(file),'r');try{await d.sync();}finally{await d.close();}
}
