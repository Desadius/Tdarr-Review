import catalog from './messages.en.js?v=20261017-settings1';

const escapeRegex=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const interpolate=(text,values)=>text.replace(/\{(\d+)\}/g,(_,i)=>values[Number(i)]??'');

// Only authored messages and whole authored patterns are translated. Unknown
// titles, paths, release names, identifiers and technical evidence stay intact.
export function createTranslator(language,entries=catalog){
 if(language!=='en')return value=>value;
 const exact=entries.exact||{},patterns=(entries.patterns||[]).map(([from,to,options={}])=>{
  const slots=[],parts=[];let end=0;
  for(const match of from.matchAll(/\{(\d+)\}/g)){parts.push(escapeRegex(from.slice(end,match.index)),'([\\s\\S]*?)');slots.push(Number(match[1]));end=match.index+match[0].length;}
  parts.push(escapeRegex(from.slice(end)));
  return {expression:new RegExp('^'+parts.join('')+'$'),to,slots,raw:new Set(options.raw||[])};
 });
 function translate(value,depth=0){
  if(typeof value!=='string'||!value||value.length>16384)return value;
  if(Object.hasOwn(exact,value))return exact[value];
  const trimmed=value.trim();
  if(trimmed!==value){const result=translate(trimmed,depth);if(result!==trimmed)return value.slice(0,value.indexOf(trimmed))+result+value.slice(value.indexOf(trimmed)+trimmed.length);}
  for(const pattern of patterns){const match=pattern.expression.exec(value);if(!match)continue;const values=[];pattern.slots.forEach((slot,i)=>{values[slot]=depth<4&&!pattern.raw.has(slot)?translate(match[i+1],depth+1):match[i+1]});return interpolate(pattern.to,values);}
  return value;
 }
 return translate;
}

function selectedLanguage(){
 if(typeof location==='undefined')return 'cs';
 const requested=new URLSearchParams(location.search).get('lang');
 if(['cs','en'].includes(requested))return requested;
 try{if(localStorage.getItem('tdarr-review-language')==='en')return 'en'}catch{}
 return 'cs';
}
export const language=selectedLanguage();
export const locale=language==='en'?'en-GB':'cs-CZ';
export const tr=createTranslator(language);
export const translateAudioTrackLabel=(label,translate=tr)=>typeof label==='string'&&/^\d+: .* · .* · \d+ kan\. · /.test(label)?translate(label):label;

export function initializeLocale(){
 document.documentElement.lang=language;
 try{localStorage.setItem('tdarr-review-language',language)}catch{}
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 while(walker.nextNode()){
  const node=walker.currentNode;if(node.parentElement?.closest('script,style,[data-i18n="ignore"]'))continue;
  const translated=tr(node.nodeValue);if(translated!==node.nodeValue)node.nodeValue=translated;
 }
 for(const node of document.querySelectorAll('[aria-label],[placeholder],[title]')){
  if(node.closest('[data-i18n="ignore"]'))continue;
  for(const attribute of ['aria-label','placeholder','title'])if(node.hasAttribute(attribute))node.setAttribute(attribute,tr(node.getAttribute(attribute)));
 }
 const selector=document.getElementById('language');
 if(selector){selector.value=language;selector.addEventListener('change',()=>{
  const value=selector.value;if(!['cs','en'].includes(value))return;
  document.dispatchEvent(new CustomEvent('review-language-change'));
  try{localStorage.setItem('tdarr-review-language',value)}catch{}
  const next=new URL(location.href);next.searchParams.set('lang',value);location.assign(next.href);
 });}
}
