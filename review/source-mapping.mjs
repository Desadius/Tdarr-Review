import fs from 'node:fs/promises';
import path from 'node:path';
import {safeFile} from './core.mjs';
// Extension changes require an exact Tdarr receipt, never a filename guess.
export async function resolveReviewSource(mediaRoot,reviewRoot,outputRelative,reviewRelative){
 let receipt;
 try{const f=await safeFile(reviewRoot,reviewRelative+'.tdarr-receipt.json');if(f.stat.size>65536)throw Error('Příliš velký záznam převodu.');receipt=JSON.parse(await fs.readFile(f.path,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!receipt||receipt.relative===outputRelative)return {relative:outputRelative,outputRelative,receipt:receipt??null};
 const source=receipt.relative;
 if(receipt.version!==1||typeof source!=='string'||! /\.(m2ts|ts)$/i.test(source)||source.replace(/\.(m2ts|ts)$/i,'.mkv')!==outputRelative)throw Error('Záznam převodu neodpovídá změně přípony.');
 const [a,b]=await Promise.all([safeFile(mediaRoot,source),safeFile(reviewRoot,reviewRelative)]);
 if(receipt.source?.size!==a.stat.size||receipt.source?.mtime!==Math.round(a.stat.mtimeMs)||receipt.output?.size!==b.stat.size||receipt.output?.mtime!==Math.round(b.stat.mtimeMs))throw Error('Zdroj nebo výsledek neodpovídá záznamu převodu.');
 const dest=path.join(path.dirname(a.path),path.basename(outputRelative));
 try{await fs.lstat(dest);throw Error('Cílový MKV již existuje; nebude přepsán.')}catch(e){if(e.code!=='ENOENT')throw e;}
 return {relative:source,outputRelative,receipt};
}
