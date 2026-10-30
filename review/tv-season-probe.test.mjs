import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runTvSeasonProbe} from './tv-season-probe.mjs';

test('Linux probe worker pins root and ancestor identities and refuses symlink or hardlink leaves', {skip:process.platform!=='linux'}, async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tv-season-probe-'));
 try{
  const media=path.join(root,'media'),review=path.join(root,'review'),relative='Series/Season 01/S01E01.mkv';
  await fs.mkdir(path.dirname(path.join(media,relative)),{recursive:true});await fs.mkdir(path.dirname(path.join(review,relative)),{recursive:true});
  await fs.writeFile(path.join(media,relative),'synthetic source');await fs.writeFile(path.join(review,relative),'synthetic result');
  const request={verifyOnly:true,pairs:[{episodeFileId:31,mediaRoot:media,reviewRoot:review,sourceRelative:relative,resultRelative:relative}]};
  const [first]=await runTvSeasonProbe(request);assert.equal(first.status,'observed');assert.ok(first.identity.source.directories.length>=4,'the private identity includes root ancestors and the in-root directory chain');
  const moved=media+'.moved';await fs.rename(media,moved);await fs.mkdir(media,{recursive:true});await fs.mkdir(path.dirname(path.join(media,relative)),{recursive:true});await fs.writeFile(path.join(media,relative),'replacement source');
  const [second]=await runTvSeasonProbe(request);assert.equal(second.status,'observed');assert.notDeepEqual(second.identity.source,first.identity.source,'a root/ancestor/leaf replacement changes the revalidation token');
  await fs.rm(media,{recursive:true,force:true});await fs.rename(moved,media);
  const resultPath=path.join(review,relative),target=path.join(root,'outside-result');await fs.writeFile(target,'outside');await fs.rm(resultPath);await fs.symlink(target,resultPath);
  const [symlink]=await runTvSeasonProbe(request);assert.equal(symlink.status,'unknown');assert.equal(symlink.reason,'unsafe_result');
  await fs.rm(resultPath);await fs.writeFile(resultPath,'result');await fs.link(resultPath,path.join(root,'result-hardlink'));
  const [hardlink]=await runTvSeasonProbe(request);assert.equal(hardlink.status,'unknown');assert.equal(hardlink.reason,'unsafe_result');
  await fs.rm(resultPath);await fs.mkdir(resultPath);
  const [directory]=await runTvSeasonProbe(request);assert.equal(directory.status,'unknown');assert.equal(directory.reason,'unsafe_result');
  await fs.rm(resultPath,{recursive:true});await fs.writeFile(resultPath,'result');
  const series=path.join(media,'Series'),movedSeries=series+'.moved',outside=path.join(root,'outside-series');await fs.rename(series,movedSeries);await fs.mkdir(outside,{recursive:true});await fs.mkdir(path.join(outside,'Season 01'),{recursive:true});await fs.writeFile(path.join(outside,'Season 01','S01E01.mkv'),'outside');await fs.symlink(outside,series,'dir');
  const [ancestorLink]=await runTvSeasonProbe(request);assert.equal(ancestorLink.status,'unknown');assert.equal(ancestorLink.reason,'unsafe_source');
  await fs.rm(series);await fs.rename(movedSeries,series);
  const sourcePath=path.join(media,relative),outsideSource=path.join(root,'outside-source');await fs.writeFile(outsideSource,'external');await fs.rm(sourcePath);await fs.link(outsideSource,sourcePath);
  const [sourceLink]=await runTvSeasonProbe(request);assert.equal(sourceLink.status,'unknown');assert.equal(sourceLink.reason,'unsafe_source');
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('Linux probe worker bounds FFprobe output, reaps timed-out children and closes on request cancellation', {skip:process.platform!=='linux'}, async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tv-season-probe-life-'));
 try{
  const media=path.join(root,'media'),review=path.join(root,'review'),relative='Series/S01E01.mkv',sourcePath=path.join(media,relative),resultPath=path.join(review,relative),receiptPath=resultPath+'.tdarr-receipt.json';
  await fs.mkdir(path.dirname(sourcePath),{recursive:true});await fs.mkdir(path.dirname(resultPath),{recursive:true});await fs.writeFile(sourcePath,'source');await fs.writeFile(resultPath,'result');await fs.writeFile(receiptPath,'{}');
  const pidFile=path.join(root,'ffprobe.pid'),hang=path.join(root,'hang.mjs');await fs.writeFile(hang,'#!/usr/bin/env node\nimport fs from "node:fs";fs.writeFileSync('+JSON.stringify(pidFile)+',String(process.pid));setInterval(()=>{},1000);',{mode:0o700});
  const request={verifyOnly:false,pairs:[{episodeFileId:9,mediaRoot:media,reviewRoot:review,sourceRelative:relative,resultRelative:relative,probe:true}],ffprobe:hang};
  await assert.rejects(runTvSeasonProbe(request,{timeoutMs:1200}),/worker_unavailable/);const timedPid=Number(await fs.readFile(pidFile,'utf8'));assert.throws(()=>process.kill(timedPid,0),{code:'ESRCH'},'timeout waits for the worker and FFprobe child to close');
  await fs.rm(pidFile,{force:true});const controller=new AbortController(),pending=runTvSeasonProbe(request,{timeoutMs:10000,signal:controller.signal});for(let i=0;i<50;i++){try{await fs.access(pidFile);break}catch{await new Promise(resolve=>setTimeout(resolve,10))}}
  const activePid=Number(await fs.readFile(pidFile,'utf8'));controller.abort();await assert.rejects(pending,/cancelled/);assert.throws(()=>process.kill(activePid,0),{code:'ESRCH'},'cancellation waits for child teardown');
  const overflow=path.join(root,'overflow.mjs');await fs.writeFile(overflow,'#!/usr/bin/env node\nprocess.stdout.write(Buffer.alloc(2*1024*1024+8192));setInterval(()=>{},1000);',{mode:0o700});
  const [value]=await runTvSeasonProbe({...request,ffprobe:overflow},{timeoutMs:10000});assert.equal(value.status,'unknown');assert.equal(value.reason,'metadata_unavailable','oversized probe output stays unknown');
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
