import test from 'node:test';
import assert from 'node:assert/strict';
import {unresolvedTransactions} from './unresolved-transactions.mjs';

const mediaRoot='/media',id='0f8fad5b-d9cb-469f-a165-70867728950e';
const journal=(extra={})=>({id,original:'/media/Film (2026)/film.mkv',review:'/review/PROD/Film (2026)/film.mkv',tmp:`/media/Film (2026)/.tdarr-review-${id}.tmp`,backup:`/media/Film (2026)/.tdarr-review-${id}.old`,originalFP:'1:2:3:4:5',reviewFP:'1:3:3:4:5',phase:'original-backed-up',journal:'/data/transactions/1b4e28ba-2fa1-11d2-883f-0016d3cca427.json',...extra});
const items=[{id:'a'.repeat(24),title:'Film',relative:'Film (2026)/film.mkv'}];

test('unresolved transactions show film, phase and reason but no path or journal content',()=>{
 const cases=[
  [journal(),{reason:'needs-inspection',phase:'original-backed-up',title:'Film',itemId:'a'.repeat(24)}],
  [journal({error:'Neplatná identita souboru v záznamu výměny.'}),{reason:'invalid-identity'}],
  [journal({error:'Neplatné cesty v záznamu výměny.'}),{reason:'invalid-paths'}],
  [{id:'1b4e28ba-2fa1-11d2-883f-0016d3cca427.json',phase:'unknown',journal:'/data/transactions/1b4e28ba-2fa1-11d2-883f-0016d3cca427.json',error:'Unexpected token } in JSON at position 3'},{reason:'unreadable',phase:'unknown',title:null,itemId:null}],
  [journal({error:"ENOENT: no such file or directory, lstat '/media/Film (2026)/film.mkv'"}),{reason:'unreadable'}],
  [journal({original:'/media/Other/x.mkv'}),{title:null,itemId:null}],
  [journal({phase:'<script>'}),{phase:'unknown'}],
 ];
 for(const [record,expected] of cases){
  const [view]=unresolvedTransactions([record],items,mediaRoot);
  assert.deepEqual(Object.keys(view).sort(),['id','itemId','journal','phase','reason','title']);
  for(const [key,value] of Object.entries(expected))assert.equal(view[key],value,key+' '+JSON.stringify(record).slice(0,60));
  assert.equal(view.journal,'1b4e28ba-2fa1-11d2-883f-0016d3cca427.json');
  assert.equal(JSON.stringify(view).includes('/'),false,'no path: '+JSON.stringify(view));
 }
 assert.deepEqual(unresolvedTransactions([],items,mediaRoot),[]);
});
