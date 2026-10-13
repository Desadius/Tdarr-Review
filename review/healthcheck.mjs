import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

// Probe the local listener while retaining the application's configured Host.
// Saved settings override environment defaults, as they do in server.mjs.
// The loopback-only /health summary is printed into Docker's health log. Conditions
// needing an operator (pending transaction, node restore, stale Recovery status) are
// reported but do not fail the check, so no restart policy interrupts them.
try {
  const file=path.join(process.env.DATA_ROOT||'/data','settings.json');
  const saved=JSON.parse(await fs.readFile(file,'utf8').catch(e=>{
    if(e.code!=='ENOENT')throw e;
    return '{}';
  }));
  const origin=saved.publicOrigin||process.env.PUBLIC_ORIGIN||'http://'+(process.env.PUBLIC_HOST||'localhost:8270');
  const request=http.get({host:'127.0.0.1',port:Number(process.env.PORT||8270),path:'/health',headers:{Host:new URL(origin).host},timeout:4000},response=>{
    let text='';response.setEncoding('utf8');
    response.on('data',chunk=>{if(text.length<65536)text+=chunk});
    response.on('end',()=>{
      if(response.statusCode!==200)process.exit(1);
      try{const s=JSON.parse(text);console.log(s.attention?.length?'Attention: '+s.attention.join(', ')+' '+JSON.stringify(s):'OK');}catch{console.log('OK (unreadable summary)');}
      process.exit(0);
    });
  });
  request.on('timeout',()=>request.destroy(new Error('Health check timed out')));
  request.on('error',()=>process.exit(1));
} catch {
  process.exit(1);
}
