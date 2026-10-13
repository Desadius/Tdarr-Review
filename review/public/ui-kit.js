// Shared DOM and formatting helpers for the Review UI modules. No application state.
import {tr,locale} from '/i18n.js?v=20261013-retention1';

export const $=id=>document.getElementById(id);
export const el=(tag,cls,text,raw=false)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=raw?text:tr(text);return n};
export const fmt=n=>Number.isFinite(n)?(n/2**30).toLocaleString(locale,{maximumFractionDigits:1})+' GiB':'Nedoloženo';
export const date=n=>n&&Number.isFinite(new Date(n).getTime())?new Date(n).toLocaleString(locale):'Čas není doložen';
export const elapsedText=n=>{n=Math.max(0,Math.floor(n));return [Math.floor(n/3600),Math.floor(n%3600/60),n%60].map(x=>String(x).padStart(2,'0')).join(':')};
export const etaText=n=>n<60?'méně než minuta':Math.ceil(n/60)<60?`asi ${Math.ceil(n/60)} min`:`asi ${Math.floor(n/3600)} h ${Math.ceil(n%3600/60)} min`;
export function poster(kind,id,title){
 const box=el('div','poster'),fallback=el('span','poster-fallback','▣'),img=el('img');fallback.setAttribute('aria-hidden','true');img.alt=tr('');img.width=96;img.height=144;img.loading='lazy';img.decoding='async';img.src=`/api/artwork/${kind}/${encodeURIComponent(id)}`;
 img.onerror=()=>{img.hidden=true;box.classList.add('missing')};box.append(fallback,img);return box;
}
export function button(text,fn,cls='secondary'){const b=el('button',cls,text);b.type='button';b.onclick=fn;return b}
export function badge(text,kind=''){return el('span','badge '+kind,text)}
export function keyed(container,records,keyOf,build){
 const old=new Map([...container.children].map(n=>[n.dataset.key,n])),focus=document.activeElement?.closest('[data-focus]')?.dataset.focus;
 let cursor=container.firstElementChild;
 for(const data of records){const key=keyOf(data),sig=JSON.stringify(data);let row=old.get(key);old.delete(key);if(!row||row.dataset.signature!==sig){const fresh=build(data);fresh.dataset.key=key;fresh.dataset.signature=sig;if(row){if(cursor===row)cursor=fresh;row.replaceWith(fresh)}row=fresh}if(row!==cursor)container.insertBefore(row,cursor);cursor=row.nextElementSibling;}
 for(const row of old.values())row.remove();
 if(focus&&document.activeElement===document.body){const replacement=[...container.querySelectorAll('[data-focus]')].find(n=>n.dataset.focus===focus);replacement?.focus({preventScroll:true})}
}
export function makeTabs(container,tabs,current,onChange){
 const oldFocus=document.activeElement?.id;container.replaceChildren();
 for(const [id,label] of tabs){const b=button(label,()=>onChange(id));b.id=container.id+'-'+id;b.setAttribute('role','tab');b.setAttribute('aria-selected',String(id===current));b.setAttribute('aria-controls',container.id==='detailTabs'?'detailBody':'recoveryPanel');b.tabIndex=id===current?0:-1;
  b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const i=tabs.findIndex(x=>x[0]===id),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;onChange(tabs[next][0]);$(container.id+'-'+tabs[next][0])?.focus()};container.append(b)}
 if(oldFocus&&oldFocus.startsWith(container.id+'-'))$(oldFocus)?.focus({preventScroll:true});
}
export function detailsFacts(facts){const dl=el('dl','facts');for(const [key,value,raw=false]of facts){dl.append(el('dt','',key),el('dd','',value,raw))}return dl}
