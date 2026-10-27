// Local demo of the real Review UI with synthetic data: no FFmpeg, Tdarr, Radarr, media or settings.
// It serves review/public/ unchanged on loopback and answers the API from fixed scenarios, so layouts
// (Kino, compact, gallery) can be checked in a browser or in screenshots. Never point it at real data.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';

const PUBLIC=fileURLToPath(new URL('../review/public/',import.meta.url));
const TYPES={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.svg':'image/svg+xml'};

/** A synthetic RGB test frame (gradient with a checker pattern) as base64 PNG. */
export function testFrame(width,height,shift=0){
 const raw=Buffer.alloc((width*3+1)*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const o=y*(width*3+1)+1+x*3,checker=((x>>6)+(y>>6))&1;raw[o]=(x*255/width+shift)&255;raw[o+1]=checker?200:60;raw[o+2]=(y*255/height)&255}
 const crc=bytes=>{let c=~0;for(const v of bytes){c^=v;for(let k=0;k<8;k++)c=c>>>1^(0xEDB88320&-(c&1))}return ~c>>>0};
 const chunk=(type,data)=>{const length=Buffer.alloc(4);length.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type),data]),sum=Buffer.alloc(4);sum.writeUInt32BE(crc(body));return Buffer.concat([length,body,sum])};
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}

const hex=n=>n.toString(16).padStart(2,'0');
const checks=done=>Object.fromEntries(['preparation','image','audio','syncStart','syncMiddle','syncEnd'].map((key,i)=>[key,i<done]));
const film=(i,title,extra={})=>({id:hex(i).repeat(12),snapshot:hex(i).repeat(32),title,relative:title+'/'+title+'.mkv',status:'ready',reason:'',originalBytes:20e9+i*1e9,reviewBytes:9e9,durationA:7200,durationB:7200,...extra});
/** Fixed synthetic scenarios: the first film is the one opened by ?film=. */
export function scenario(){
 const items=[film(1,'Syntetický film s velmi dlouhým názvem pro kontrolu rozložení (2026)'),film(2,'Krátký'),film(3,'Blokovaný film',{status:'blocked',reason:'Výsledek nemá právě jednu video stopu. Počet video stop: 2.'}),film(4,'Rozpracovaný film'),film(5,'Schválený film'),...Array.from({length:7},(_,i)=>film(6+i,'Další film '+(i+1)))];
 const session=(item,step,done,complete=false)=>({version:1,snapshot:item.snapshot,revision:complete?3:1,requirements:{hdr:false},complete,observations:{},updated:'2026-10-18T10:00:00Z',session:{method:'review',device:'',step,scope:{originalIndex:1,reviewIndex:2,seconds:600},checks:checks(done),note:'',deferred:false}});
 const reviewSessions={[items[0].id]:session(items[0],1,1),[items[3].id]:session(items[3],2,2),[items[4].id]:session(items[4],4,6,true)};
 return {items,reviewSessions,approvals:{[items[4].id]:{reviewRevision:3,approvedAt:'2026-10-18T11:00:00Z'}},previews:{[items[1].id]:{snapshot:items[1].snapshot,state:'running',ready:1,total:4,jobs:[{status:'running'}]}}};
}

// Optional browser-side switches, read from the page URL: layout=gallery, mode=frames, panel=closed, focus=on,
// keys=Enter,? (pressed in the single pass in turn) and still=off. The demo has no FFmpeg, so the single-pass stage
// shows the synthetic test frame as a still in place of the excerpt video.
const DRIVER=`(()=>{const q=new URLSearchParams(location.search),wait=ms=>new Promise(r=>setTimeout(r,ms));setTimeout(async()=>{
 if(q.get('layout')==='gallery'){const r=document.querySelector('input[name=layout][value=gallery]');if(r){r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));r.click()}}
 if(q.get('mode')==='frames'){[...document.querySelectorAll('button')].find(n=>/Statické snímky|Still frames/.test(n.textContent))?.click();await wait(400);document.querySelector('.workflow-tools form.comparison-controls')?.requestSubmit()}
 const film=/film=([a-f0-9]{24})/.exec(location.hash)?.[1],pair=document.querySelector('.single-pass .guided-pair');
 if(film&&pair&&q.get('still')!=='off'){const frame=await fetch('/api/items/'+film+'/frames',{method:'POST',body:'{}'}).then(r=>r.json());pair.style.background='#000 center/contain no-repeat url(data:image/png;base64,'+frame.original+')'}
 for(const key of (q.get('keys')||'').split(',').filter(Boolean)){document.querySelector('.single-pass')?.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));await wait(300)}
 await wait(400);if(q.get('panel')==='closed')document.querySelector('[data-panel-toggle]')?.click();if(q.get('focus')==='on')document.querySelector('[data-focus-toggle]')?.click();
},1200)})();`;

/** Starts the demo on 127.0.0.1 (port 0 picks a free one). Returns its base URL and close(). */
export async function startDemo({port=0,frame={width:1920,height:1080}}={}){
 const data=scenario(),frames={original:testFrame(frame.width,frame.height),review:testFrame(frame.width,frame.height,40)};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');let body='';for await(const chunk of req)body+=chunk;
  const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))};
  try{
   if(url.pathname==='/api/items')return json({label:'Demo Review',version:'demo',serverTime:Date.now(),history:[],recovery:[],pendingRestores:[],restorePending:0,active:null,batch:null,batchRunning:false,...structuredClone(data)});
   const item=data.items.find(x=>url.pathname.startsWith('/api/items/'+x.id+'/'));
   if(item&&url.pathname.endsWith('/review-session'))return json(req.method==='GET'?data.reviewSessions[item.id]||scenarioSession(item):{...(data.reviewSessions[item.id]||scenarioSession(item)),...JSON.parse(body||'{}')});
   if(item&&url.pathname.endsWith('/frames'))return json({seconds:600,hdr:false,...frames});
   if(item&&url.pathname.endsWith('/audio-compare'))return json(JSON.parse(body||'{}').mode==='tracks'?{original:[{index:1,label:'1: eng · dts · 6 kan.'}],review:[{index:2,label:'2: eng · eac3 · 6 kan.'}]}:{pending:true,preparation:null});
   if(item&&url.pathname.endsWith('/preview-status'))return json({});
   if(url.pathname==='/api/radarr/requests')return json({requests:[],recoveryRuntime:{present:false},recoveryConfig:null});
   if(url.pathname==='/api/recovery/runtime')return json({mode:'off',state:'off'});
   if(url.pathname.startsWith('/api/'))return json({code:'not_found',error:'Demo has no such route.'},404);
   const name=url.pathname==='/'?'index.html':path.basename(url.pathname),type=TYPES[path.extname(name)];
   if(!type)return json({code:'not_found'},404);
   let text=(await fs.readFile(path.join(PUBLIC,name))).toString('utf8').replaceAll('?v=__APP_VERSION__','?v=demo');
   if(name==='index.html')text=text.replace('</body>','<script>'+DRIVER+'</script></body>');
   res.writeHead(200,{'content-type':type,'cache-control':'no-store'});res.end(text);
  }catch{json({code:'not_found'},404)}
 });
 const scenarioSession=item=>({version:1,snapshot:item.snapshot,revision:0,requirements:{hdr:false},complete:false,observations:{},updated:null,session:{method:'review',device:'',step:0,scope:{originalIndex:1,reviewIndex:2,seconds:600},checks:checks(0),note:'',deferred:false}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
 const base='http://127.0.0.1:'+server.address().port;
 return {base,host:server.address().address,film:base+'/?lang=cs#attention?film='+data.items[0].id,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)})};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.argv[process.argv.indexOf('--port')+1])||18399;
 const demo=await startDemo({port});
 console.log('Review UI demo with synthetic data (loopback only): '+demo.base+'/?lang=cs');
 console.log('Open a film in the Kino layout: '+demo.film+'  (add &mode=frames, &panel=closed, &focus=on or layout=gallery to the query)');
}
