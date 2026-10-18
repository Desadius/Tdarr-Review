import test from 'node:test';
import assert from 'node:assert/strict';
import {serverHarness,linuxServer} from './test-helpers/server.mjs';

// Walk the UI as a browser would: the page, then every module, script and stylesheet it references.
async function crawl(f){
 const urls=new Map(),queue=['/'];
 while(queue.length){
  const route=queue.shift(),response=await f.request(route);assert.equal(response.status,200,route);
  const text=await response.text();
  for(const [,url] of text.matchAll(/(?:from\s*|import\s*\(\s*|src=|href=)["'](\/[^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)){
   const path=url.split('?')[0];if(!urls.has(path))urls.set(path,new Set());if(!urls.get(path).has(url)){urls.get(path).add(url);queue.push(url);}
  }
 }
 return urls;
}

test('every browser module loads under one URL carrying the running app version',linuxServer,async t=>{
 const f=await serverHarness();t.after(()=>f.close());await f.start({env:{APP_VERSION:'9.8.7-test'}});
 const urls=await crawl(f);
 assert.ok(urls.has('/app.js')&&urls.has('/i18n.js')&&urls.has('/ui-kit.js')&&urls.has('/style.css'),[...urls.keys()].join(' '));
 const split=[...urls].filter(([,seen])=>seen.size>1).map(([path,seen])=>path+' is loaded under '+[...seen].join(', '));
 assert.deepEqual(split,[],'a module evaluated twice splits its state');
 for(const [path,seen] of urls)assert.equal([...seen][0],path+'?v=9.8.7-test',path);
});
