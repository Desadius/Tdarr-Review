import test from 'node:test';
import assert from 'node:assert/strict';
import {renderLibraryPaths,renderPathDiagnostics,libraryPathsPatch} from './public/library-paths-view.js';
import {createTranslator} from './public/i18n.js';
import messages from './public/shared-settings-messages.js';
import {ERROR_MESSAGES} from './public/error-messages.js';

class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.dataset={};this.style={};this.className='';this.classList={add:value=>{this.className+=' '+value}};this.text='';}
 append(...nodes){for(const node of nodes){if(node&&typeof node==='object'){node.parentElement=this;this.children.push(node)}}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes)}
 setAttribute(key,value){this.attributes[key]=String(value)}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null}
 querySelectorAll(selector){const field=/^\[data-tv-field="([^"]+)"\]$/.exec(selector),action=/^\[data-tv-action\]$/.test(selector);const found=[];const visit=node=>{if(field&&node.dataset?.tvField===field[1]||action&&node.dataset?.tvAction||selector==='button'&&node.tagName==='button')found.push(node);for(const child of node.children||[])visit(child)};visit(this);return found}
 get textContent(){return this.text+this.children.map(child=>child.textContent||'').join('')}
 set textContent(value){this.text=String(value);this.children=[]}
}
const ui={
 el:(tag,cls,text)=>{const node=new Element(tag);node.className=cls||'';if(text!==undefined)node.textContent=String(text);return node},
 button:(text,fn)=>{const node=new Element('button');node.textContent=text;node.onclick=fn;return node},
 tr:value=>value,
};
const descriptor={enabled:false,mediaRoot:'/tv',reviewRoot:'/out-tv',libraryId:'tv-library',sourceRoots:['/shows'],tdarrReviewRoot:'/transcodes-tv',reviewPrefixes:['encoded'],sonarrRoot:'/series',quarantineRoot:'/quarantine-tv',reports:'/reports-tv'};

test('editing a TV namespace preserves the whole TV descriptor and creates a TV-only draft patch',()=>{
 let changed;const panel=renderLibraryPaths({tv:descriptor,onChange:value=>{changed=value},ui});
 const tdarr=panel.querySelector('[data-tv-field="tdarrReviewRoot"]');tdarr.value='/tdarr/shows';tdarr.oninput();
 assert.equal(changed.enabled,false);assert.equal(changed.tdarrReviewRoot,'/tdarr/shows');assert.equal(changed.sourceRoots[0],'/shows');assert.equal(changed.sonarrRoot,'/series');assert.equal(changed.reviewPrefixes[0],'encoded');
 const movies={mediaRoot:'/films',reviewRoot:'/films-out',sourceRoots:['/movies'],nested:{marker:'untouched'}};
 assert.deepEqual(libraryPathsPatch(changed,{libraries:{tv:descriptor},review:movies}),{libraries:{tv:changed}});
 assert.deepEqual(movies,{mediaRoot:'/films',reviewRoot:'/films-out',sourceRoots:['/movies'],nested:{marker:'untouched'}});
 const remove=panel.querySelectorAll('button').find(button=>button.textContent==='Odebrat TV cesty');remove.onclick();
 assert.equal(changed,null);assert.deepEqual(libraryPathsPatch(changed,{libraries:{tv:descriptor},review:movies}),{libraries:{tv:null}});
 assert.equal(libraryPathsPatch(descriptor,{libraries:{tv:descriptor}}),null);
});

test('path diagnostic renders every status, configured container paths, issues and read-only limits',()=>{
 const statuses=['ready','not_configured','missing_or_unmounted','not_directory','not_file','unreadable','not_writable','unsafe_path','unavailable'];
 const paths={readOnly:true,processingEnabled:false,libraries:[{id:'tv',enabled:false,paths:[...statuses.map((status,index)=>({role:index===0?'source':'result',path:'/container/path-'+index,status,readable:status==='ready',writable:false,required:index<2})),{role:'reports',path:'/container/reports',status:'ready',readable:true,writable:false,required:false}],issues:[{code:'namespace_unverified',roles:['source','result']},{code:'processing_unavailable',roles:[]}],ok:false}]};
 const rendered=renderPathDiagnostics(paths,ui),text=rendered.textContent;
 for(const status of ['Připraveno','Není nastaveno','Chybí nebo není připojeno','Není adresář','Není soubor','Nelze číst','Nelze zapisovat','Nebezpečná cesta','Nelze ověřit'])assert.ok(text.includes(status),status);
 assert.ok(text.includes('/container/path-0'));assert.ok(text.includes('Kontrola je pouze pro čtení. Zpracování knihoven se tímto tlačítkem nespouští.'));
 assert.ok(text.includes('Překlad cesty mezi kontejnery nelze ověřit.'));assert.ok(text.includes('Zpracování TV zatím není dostupné.'));
 assert.ok(text.includes('Zápis se nevyžaduje'));assert.doesNotMatch(text,/Zápis ověřen/);assert.equal((text.match(/\/container\/path-/g)||[]).length,9);
});

test('unsaved TV edits disable the saved-revision diagnostic button',()=>{
 let checks=0;const panel=renderLibraryPaths({tv:descriptor,dirty:true,onCheck:()=>checks++,ui});
 assert.equal(panel.pathCheckButton.disabled,true);assert.equal(panel.pathDirtyHint.hidden,false);panel.pathCheckButton.onclick();assert.equal(checks,0);
});

test('disabled Add and Remove TV actions do not change the draft while busy or checking paths',()=>{
 let changes=0;const added=renderLibraryPaths({tv:null,disabled:true,onChange:()=>changes++,ui});
 const add=added.querySelectorAll('button').find(button=>button.textContent==='Přidat cestu knihovny TV');
 assert.equal(add.disabled,true);add.onclick();assert.equal(changes,0);
 const present=renderLibraryPaths({tv:descriptor,checking:true,onChange:()=>changes++,ui});
 const remove=present.querySelectorAll('button').find(button=>button.textContent==='Odebrat TV cesty');
 assert.equal(remove.disabled,true);remove.onclick();assert.equal(changes,0);
});

test('new TV path and processing-unavailable messages have English translations',()=>{
 const errorMessages=Object.fromEntries(Object.values(ERROR_MESSAGES).map(message=>[message.cs,message.en]));
 const tr=createTranslator('en',{exact:{...errorMessages,...messages}});
 assert.equal(tr('Ověřit cesty knihoven'),'Check library paths');
 assert.equal(tr('Nebezpečná cesta'),'Unsafe path');assert.equal(tr('Oprávnění zápisu dostupné'),'Write permission available');
 assert.equal(tr(ERROR_MESSAGES.settings_tv_processing_unavailable.cs),ERROR_MESSAGES.settings_tv_processing_unavailable.en);
});
