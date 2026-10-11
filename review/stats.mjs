import fs from 'node:fs/promises';
import path from 'node:path';
import {safeFile} from './core.mjs';
export function evidence(jobs,transactions,config){
 const byFile=new Map();
 const aliases=new Map(transactions.filter(t=>t.phase==='complete'&&t.destination&&t.original?.startsWith(config.mediaRoot+'/')&&t.destination===t.original.replace(/\.(m2ts|ts)$/i,'.mkv')).map(t=>[t.original.slice(config.mediaRoot.length+1),t.destination.slice(config.mediaRoot.length+1)]));
 const add=(relative,start,end,review)=>{if(!relative||!Number.isFinite(start)||!Number.isFinite(end)||start<=end||end<=0)return;const list=byFile.get(relative)||[];list.push({start,end,review});byFile.set(relative,list)};
 for(const j of jobs){if(j.status!=='Transcode success'||config.libraryId&&j.DB!==config.libraryId)continue;const file=String(j.file).replaceAll('\\','/'),root=config.sourceRoots[0];if(file.startsWith(root+'/')){const rel=file.slice(root.length+1);add(aliases.get(rel)||rel,Math.round(j.fileSizeStartGB*2**30),Math.round(j.fileSizeEndGB*2**30),false)}}
 for(const t of transactions){if(t.phase!=='complete'||!t.original?.startsWith(config.mediaRoot+'/'))continue;const rel=t.original.slice(config.mediaRoot.length+1);add(aliases.get(rel)||rel,Number(t.originalFP?.split(':')[2]),Number(t.reviewFP?.split(':')[2]),true)}
 return byFile;
}
export function countFile(records,current){
 const matches=records.filter(x=>x.end===current);if(!matches.length)return null;
 const start=Math.max(...records.map(x=>x.start));
 const reviewMatches=matches.filter(x=>x.review);
 const reviewStart=reviewMatches.length?Math.max(...records.filter(x=>x.review).map(x=>x.start)):current;
 return {saved:start-current,reviewSaved:Math.min(start-current,Math.max(0,reviewStart-current)),original:start,current};
}
export async function statistics({dbRows,config,data,items}){
 const warnings=[];let jobs=[],reported=null;
 try{jobs=await dbRows('jobsjsondb');const s=(await dbRows('statisticsjsondb'))[0];if(Number.isFinite(s?.sizeDiff))reported=s.sizeDiff*2**30}catch{warnings.push('Statistika Tdarru není dostupná.')}
 const transactions=[];for(const name of await fs.readdir(path.join(data,'transactions'))){if(!name.endsWith('.json'))continue;try{transactions.push(JSON.parse(await fs.readFile(path.join(data,'transactions',name),'utf8')))}catch{warnings.push('Některý protokol Review nelze přečíst.')}}
 let saved=0,reviewSaved=0,count=0,reviewCount=0,original=0,current=0,unverified=0;
 for(const [relative,records] of evidence(jobs,transactions,config)){
  try{const f=await safeFile(config.mediaRoot,relative),result=countFile(records,f.stat.size);if(!result){unverified++;continue}saved+=result.saved;reviewSaved+=result.reviewSaved;original+=result.original;current+=result.current;count++;if(result.reviewSaved)reviewCount++}catch{unverified++}
 }
 return {at:Date.now(),saved,reviewSaved,count,reviewCount,original,current,percent:original?saved/original*100:0,reported,unverified,pendingBytes:items.reduce((n,i)=>n+Math.max(0,(i.originalBytes||0)-(i.reviewBytes||0)),0),pendingCount:items.length,warnings:[...new Set(warnings)]};
}
