import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

// Probe the local listener while retaining the application's configured Host.
// Saved settings override environment defaults, as they do in server.mjs.
try {
  const file=path.join(process.env.DATA_ROOT||'/data','settings.json');
  const saved=JSON.parse(await fs.readFile(file,'utf8').catch(e=>{
    if(e.code!=='ENOENT')throw e;
    return '{}';
  }));
  const origin=saved.publicOrigin||process.env.PUBLIC_ORIGIN||'http://'+(process.env.PUBLIC_HOST||'localhost:8270');
  const request=http.get({host:'127.0.0.1',port:Number(process.env.PORT||8270),path:'/',headers:{Host:new URL(origin).host},timeout:4000},response=>{
    response.resume();
    response.on('end',()=>process.exit(response.statusCode===200?0:1));
  });
  request.on('timeout',()=>request.destroy(new Error('Health check timed out')));
  request.on('error',()=>process.exit(1));
} catch {
  process.exit(1);
}
