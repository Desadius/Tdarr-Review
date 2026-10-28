import test from 'node:test';
import assert from 'node:assert/strict';
import {createTranslator} from './public/i18n.js';
import catalog from './public/messages.en.js';
import {attentionView} from './public/recovery-view.js';
import {installedAssessmentView} from './public/installed-assessment-view.js';

// The failed or skipped transcode in Czech and English (#232): cause, retry action, blockers and the untranscoded disclosure.
class Element {
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.dataset={};this.className='';this.textContent=''}
 append(...nodes){this.children.push(...nodes)}
 setAttribute(name,value){this.attributes[name]=String(value)}
 addEventListener(){}
}
const texts=node=>[node.textContent,...node.children.flatMap(texts)].filter(Boolean);
function withDocument(run){
 const previous=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};
 try{return run()}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous}
}
const base={location:{},blockers:[]};
const CASES=[
 ['operational retry',{...base,recommended:'retryTranscode',actions:[{id:'retryTranscode',changes:'starts-work'}],diagnosis:{cause:'operational'}},
  ['Zkusit převod znovu','Provozní chyba (oprávnění, disk, paměť nebo síť)'],['Retry the transcode','Operational error (permissions, disk, memory or network)','Tdarr queues the file again and transcodes it; nothing in the library moves.']],
 ['unrecognized cause',{...base,recommended:'retryTranscode',actions:[{id:'retryTranscode',changes:'starts-work'}],diagnosis:{cause:'unrecognized'}},
  ['Příčina není rozpoznaná'],['Cause not recognized']],
 ['decode damage',{...base,actions:[],blockers:['transcode-decode-damage'],diagnosis:{cause:'decode-damage',message:'Invalid NAL unit size (# > #).'}},
  ['Poškození při dekódování','Invalid NAL unit size (# > #).'],['Decoding damage','Decoder message: Invalid NAL unit size (# > #).','Recovery handles the damage in its own case']],
 ['unreadable report',{...base,actions:[],blockers:['transcode-report-unreadable'],diagnosis:{cause:'unreadable'}},
  ['Report nelze přečíst'],['The report cannot be read','Review offers no retry until the cause is known']],
 ['second failure',{...base,actions:[],blockers:['transcode-retry-failed-again'],diagnosis:{cause:'operational'}},
  ['Opakovaný převod také selhal'],['The retried transcode failed too; inspect Tdarr']],
 ['Not required',{...base,recommended:'assessInstalled',actions:[{id:'assessInstalled',changes:'nothing'}],blockers:['transcode-not-required','restore-over-installed']},
  ['Ponechat aktuální kopii'],['Keep the current copy',"Tdarr's rules do not require transcoding the replacement; a retry would skip it again."]],
];
for(const [name,attention,czech,english]of CASES){
 test('the attention model renders '+name+' in Czech',()=>withDocument(()=>{
  const all=texts(attentionView(attention,()=>{},createTranslator('cs'))).join('\n');
  for(const part of czech)assert.ok(all.includes(part),part);
 }));
 test('the attention model renders '+name+' in English',()=>withDocument(()=>{
  const translate=createTranslator('en'),view=attentionView(attention,()=>{},translate);
  // The view's own elements are translated by the page's language; here the same catalogue is applied to each rendered text.
  const all=texts(view).map(translate).join('\n');
  for(const part of english)assert.ok(all.includes(part),part+'\n'+all);
 }));
}
test('a decode-damage case offers no retry and shows no path or value',()=>withDocument(()=>{
 const view=attentionView(CASES[2][1],()=>{},createTranslator('cs'));
 const buttons=[];(function walk(n){if(n.tagName==='BUTTON')buttons.push(n);n.children.forEach(walk)})(view);
 assert.deepEqual(buttons.map(b=>b.dataset.attentionAction),[]);assert.ok(!texts(view).join(' ').includes('/'));
}));
test('the retry action runs the server-listed action',()=>withDocument(()=>{
 const ran=[];const view=attentionView(CASES[0][1],a=>ran.push(a.id),createTranslator('cs'));
 const buttons=[];(function walk(n){if(n.tagName==='BUTTON')buttons.push(n);n.children.forEach(walk)})(view);
 buttons.find(b=>b.dataset.attentionAction==='retryTranscode').onclick();assert.deepEqual(ran,['retryTranscode']);
}));
for(const [language,expected]of [['cs','Tato kopie nebyla převedena'],['en','This copy was not transcoded']])test('the untranscoded assessment discloses that the copy was not transcoded in '+language,()=>withDocument(()=>{
 const translate=createTranslator(language),view=installedAssessmentView({eligible:true,untranscoded:true,requirements:{hdr:false},draft:null,snapshot:'s'},{save(){},approve(){}},translate);
 assert.ok(texts(view).map(translate).join('\n').includes(expected));
 const plain=installedAssessmentView({eligible:true,requirements:{hdr:false},draft:null,snapshot:'s'},{save(){},approve(){}},translate);
 assert.ok(!texts(plain).map(translate).join('\n').includes(expected),'a transcoded copy has no such line');
}));
test('the retry confirmation says Tdarr transcodes again, nothing moves and the quarantine is kept, in English',()=>{
 const english=Object.entries(catalog.exact).filter(([cs])=>cs.startsWith('Zopakovat převod?')||cs.startsWith('Předchozí opakování nebylo potvrzeno. Potvrzením')).map(([,en])=>en);
 assert.equal(english.length,2);
 for(const text of english){assert.match(text,/queues exactly this file again/);assert.match(text,/[Nn]othing in the library moves/);assert.match(text,/quarantine/);}
 assert.match(english.find(t=>t.startsWith('Retry')),/only once/);assert.match(english.find(t=>t.startsWith('The previous')),/checked Tdarr/);
});
