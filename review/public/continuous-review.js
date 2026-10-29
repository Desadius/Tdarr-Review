// Single pass over three excerpts: the image fills the workspace and the checks, prompts and decisions are an overlay
// driven by keys. Playback never confirms anything; every check is one explicit key press or click (docs/GUIDED-COMPARISON.md).
import {translateAudioTrackLabel} from './i18n.js?v=__APP_VERSION__';
export const SEGMENT_SYNC=Object.freeze(['syncStart','syncMiddle','syncEnd']);
const SEGMENT_TITLES=['Začátek filmu','Střed filmu','Konec filmu'];
const CHIP_KEYS=[['image','1','Obraz'],['audio','2','Zvuk'],['sync','3','Synchronizace']];

/** The checks Enter confirms after excerpt `segment`: picture and sound until confirmed once, and that excerpt's sync. */
export function segmentChecks(checks,segment){return ['image','audio',SEGMENT_SYNC[segment]].filter(key=>checks?.[key]!==true)}

/** Where a reopened review continues: preparation first, then the first excerpt without its sync, then the decision. */
export function resumePoint(checks){
 if(checks?.preparation!==true)return {prompt:'start',segment:0};
 const open=SEGMENT_SYNC.findIndex(key=>checks[key]!==true);
 if(open>=0)return {prompt:'resume',segment:open};
 if(checks.image!==true||checks.audio!==true)return {prompt:'segment',segment:2};
 return {prompt:'decision',segment:2};
}

const editable=target=>!!target?.isContentEditable||!!target?.closest?.('input:not([type="range"]),textarea,select,[contenteditable="true"]');
const clock=value=>{const seconds=Math.max(0,Math.floor(Number(value)||0)),h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return (h?h+':'+String(m).padStart(2,'0'):String(m))+':'+String(s).padStart(2,'0')};

export function mountContinuousReview(host,{item,session,hdrRequired=false,tr=x=>x,openGuidedComparison,playerOptions={},formatBytes=x=>String(x),
 onConfirm=()=>{},onUnconfirm=()=>{},onDevice=()=>{},onNote=()=>{},onSaveNote=async()=>{},onDefer=async()=>{},onReject=()=>{},onApprove=()=>{},onApproveOnly=()=>{},onNext=()=>{},onChrome=()=>{},onScope=()=>{},onComparison=()=>{},onPreparation=()=>{},onExternalReview=()=>{},capabilities={reject:true,next:true,approveReplace:true}}={}){
 const doc=host.ownerDocument||document;
 const make=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=tr(text);return node};
 const action=(label,key,fn,cls='secondary')=>{const node=make('button',cls);node.type='button';if(key)node.append(make('kbd','',key));node.append(make('span','',label));node.setAttribute('aria-label',tr(label)+(key?' ('+key+')':''));node.onclick=fn;return node};
 const root=make('section','single-pass');root.tabIndex=0;root.setAttribute('role','region');root.setAttribute('aria-label',tr('Posouzení filmu v jednom průchodu'));
 const stage=make('div','single-pass-stage');
 const hud=make('div','single-pass-hud'),position=make('p','single-pass-position'),pairLine=make('p','single-pass-pair'),chips=make('ul','single-pass-chips');chips.setAttribute('aria-label',tr('Stav kontrol'));hud.append(position,pairLine,chips);
 const corner=make('div','single-pass-corner'),saved=make('output','single-pass-saved');saved.setAttribute('aria-live','polite');
 corner.append(saved,action('Stopy a časy','T',()=>toggleOptions()),action('Detail filmu','',()=>onChrome(true)),action('Nápověda','?',()=>setHelp(true)));
 const legend=make('p','single-pass-legend');legend.setAttribute('aria-hidden','true');
 for(const [key,label]of [['Space','přehrát'],['A','zvuk'],['W','čára'],['[ ]','úsek'],['1 2 3','potvrdit'],['Enter','dál'],['R','znovu'],['X','problém'],...(capabilities.reject?[['Z','zamítnout']]:[]),['?','nápověda']])legend.append(make('kbd','',key),make('span','',label));
 const prompt=make('div','single-pass-prompt');prompt.setAttribute('role','dialog');prompt.setAttribute('aria-modal','false');prompt.hidden=true;
 const help=make('div','single-pass-help');help.setAttribute('role','dialog');help.setAttribute('aria-label',tr('Nápověda k posouzení'));help.hidden=true;
 root.append(stage,hud,corner,legend,prompt,help);host.replaceChildren(root);
 let state={session,baseline:session,allowed:true,saving:false,conflict:false,dirty:false,revision:0};
 let segment=0,overlay='none',hidden=false,dead=false,playback={status:'idle'},deviceInput=null;
 const tracks=playerOptions.tracks;
 const trackLabel=(list,index)=>translateAudioTrackLabel(list?.find(track=>track.index===index)?.label||(Number.isInteger(index)?String(index):'—'),tr);
 const pairText=()=>{const scope=state.session.scope||{};return trackLabel(tracks?.original,scope.originalIndex)+' ↔ '+trackLabel(tracks?.review,scope.reviewIndex)};
 const excerpts=()=>state.session.comparison?.excerpts||playerOptions.comparison?.excerpts||[0,0,0];
 const checkKey=name=>name==='sync'?SEGMENT_SYNC[segment]:name;
 const checkState=key=>state.session.checks?.[key]===true?(state.baseline?.checks?.[key]===true?'saved':'confirmed'):'empty';

 const cleanup=openGuidedComparison?.(item,{...playerOptions,stage:true,host:stage,onScopeChange:onScope,
  onTimesChange:times=>onComparison({...(state.session.comparison||playerOptions.comparison),excerpts:times}),
  onRoutingChange:value=>onComparison({...(state.session.comparison||playerOptions.comparison),...value}),
  onPlaybackState:value=>observePlayback(value),onPreparation,onExternalReview,onExitPlayer:()=>root.focus({preventScroll:true})});
 const player=cleanup?.controller||null;
 const command=(name,value)=>player?.command(name,value);
 function play(index){segment=Math.max(0,Math.min(2,index));show('none');void command('excerpt',{index:segment,play:true});render()}
 // After an excerpt its prompt; after the last one, once everything is confirmed, the decision.
 const after=()=>segment>=2&&['image','audio',...SEGMENT_SYNC].every(key=>state.session.checks[key]===true)?'decision':'segment';
 function observePlayback(value){
  playback=value||{status:'idle'};if(dead)return;
  if(Number.isInteger(value?.excerptIndex))segment=value.excerptIndex;
  if(value?.status==='done'&&['none','resume'].includes(overlay))show(after());
  render();
 }
 function confirmSegment(){
  const keys=segmentChecks(state.session.checks,segment);if(keys.length)onConfirm(keys,segment);
  const later=SEGMENT_SYNC.findIndex((key,i)=>i>segment&&state.session.checks[key]!==true),open=SEGMENT_SYNC.findIndex(key=>state.session.checks[key]!==true);
  if(later>=0)play(later);else if(open>=0)play(open);else show('decision');
 }
 function toggleCheck(name){const key=checkKey(name);if(state.session.checks[key]===true)onUnconfirm(key);else onConfirm([key],segment);render()}
 function start(){
  if(hdrRequired&&String(state.session.device||'').trim().length<2){deviceInput?.focus();return}
  if(state.session.checks.preparation!==true)onConfirm(['preparation'],0);
  play(resumePoint({...state.session.checks,preparation:true}).segment);
 }
 function toggleOptions(open=!player?.optionsOpen){player?.options(open);if(!open)root.focus({preventScroll:true})}
 function setHelp(open){help.hidden=!open;prompt.hidden=open||overlay==='none';if(open)help.querySelector('button')?.focus();else root.focus({preventScroll:true})}
 function show(next){overlay=next;renderPrompt()}

 function renderPrompt(){
  prompt.replaceChildren();deviceInput=null;prompt.hidden=overlay==='none';root.dataset.prompt=overlay;
  if(overlay==='none')return;
  const title=make('h3');title.id='single-pass-prompt-'+item.id;prompt.setAttribute('aria-labelledby',title.id);prompt.append(title);
  const row=make('div','single-pass-actions');
  if(overlay==='start'){
   title.textContent=tr('Porovnáváš správný originál a tento převod?');
   prompt.append(make('p','single-pass-pair',pairText()),make('p','details',tr('Úseky:')+' '+excerpts().map(clock).join(' · ')));
   if(hdrRequired){const label=make('label','workflow-field','Zařízení pro kontrolu HDR/Dolby Vision'),input=make('input');input.maxLength=160;input.value=state.session.device||'';input.placeholder=tr('Například TV v obýváku · Plex');input.dataset.workflowWrite='';input.oninput=()=>onDevice(input.value);label.append(input);prompt.append(label);deviceInput=input}
   row.append(action('Ano, začít','Enter',start,'primary'),action('Stopy a časy','T',()=>toggleOptions(true)));
  }else if(overlay==='resume'){
   title.textContent=tr('Pokračovat úsekem')+' '+(segment+1)+' · '+tr(SEGMENT_TITLES[segment]);
   row.append(action('Přehrát','Enter',()=>play(segment),'primary'));
  }else if(overlay==='segment'){
   title.textContent=tr('Úsek')+' '+(segment+1)+' '+tr('dohrál. Jak to vypadá?');
   const list=make('div','single-pass-prompt-chips');
   for(const [name,key,label]of CHIP_KEYS){const chip=action(label,key,()=>toggleCheck(name),'single-pass-chip');chip.dataset.chip=name;list.append(chip)}
   prompt.append(list);
   row.append(action(segment<2?'Potvrdit a pokračovat':'Potvrdit a rozhodnout','Enter',confirmSegment,'primary'),action('Přehrát znovu','R',()=>play(segment)),action('Problém','X',()=>show('problem')));
  }else if(overlay==='problem'){
   title.textContent=tr('Co je špatně?');
   const label=make('label','workflow-field','Poznámka k posouzení'),note=make('textarea');note.rows=3;note.maxLength=2000;note.value=state.session.note||'';note.placeholder=tr('Co jsi zjistil nebo co zbývá ověřit?');note.oninput=()=>{onNote(note.value);renderDeferState()};label.append(note);prompt.append(label);
   const defer=action('Odložit posouzení','',()=>{if(!defer.disabled)void onDefer()});defer.dataset.singlePassDefer='';
   row.append(defer,action('Uložit poznámku','',()=>void onSaveNote()));if(capabilities.reject)row.append(action('Zamítnout převod','Z',()=>onReject(),'reject'));row.append(action('Zpět','Esc',()=>show(after())));
   void Promise.resolve().then(()=>note.focus?.());
  }else if(overlay==='decision'){
   title.textContent=tr('Rozhodnutí');
   const facts=make('dl','facts'),saving=Number(item.originalBytes)-Number(item.reviewBytes);
   for(const [label,value]of [['Možná úspora',Number.isFinite(saving)?formatBytes(saving)+(item.originalBytes>0?' · '+Math.round(saving/item.originalBytes*100)+' %':''):tr('Nedoloženo')],['Zvukové stopy',pairText()]])facts.append(make('dt','',label),make('dd','',value));
   prompt.append(facts);
   if(hdrRequired){const hdr=action('HDR/Dolby Vision ověřeno na zařízení','D',()=>{if(state.session.checks.hdr!==true)onConfirm(['hdr'],segment);render()},'single-pass-chip');hdr.dataset.chip='hdr';hdr.append(make('span','',' · '+(state.session.device||'')));prompt.append(hdr)}
   if(!item.canApproveDuration){const only=action('Schválit','S',()=>{if(!only.disabled)onApproveOnly()},'primary');only.dataset.workflowApproveOnly='';row.append(only)}
   if(capabilities.approveReplace){const approve=action(item.canApproveDuration?'Posoudit rozdíl délky':'Schválit a nahradit','Shift+S',()=>{if(!approve.disabled)onApprove()},item.canApproveDuration?'primary':'secondary');approve.dataset.workflowApprove='';row.append(approve)}
   if(capabilities.reject)row.append(action('Zamítnout','Z',()=>onReject(),'reject'));if(capabilities.next)row.append(action('Další film','N',()=>onNext()));row.append(action('Problém','X',()=>show('problem')));
  }
  prompt.append(row);render();
 }
 function renderDeferState(){const defer=prompt.querySelector('[data-single-pass-defer]');if(defer)defer.disabled=!state.allowed||!String(state.session.note||'').trim()}
 function renderHelp(){
  help.replaceChildren(make('h3','','Nápověda k posouzení'),action('Zavřít','Esc',()=>setHelp(false)));
  const explanation=['Tři úseky ze začátku, středu a konce filmu se přehrají za sebou, každý jednou. Po každém úseku potvrdíš, co jsi ověřil. Přehrání ani technická kontrola nic nepotvrzuje.','Obraz a zvuk stačí potvrdit jednou, synchronizaci v každém úseku. Každé potvrzení se hned uloží a váže se ke zvoleným stopám a času úseku. Při dalším otevření pokračuješ prvním nepotvrzeným úsekem.','Schválit uloží rozhodnutí bez nahrazení.', 'Meze náhledu: ztrátový SDR náhled a mono zvuk nedokládají původní rozlišení, prostorový mix ani HDR. HDR/Dolby Vision ověř na pojmenovaném vhodném zařízení.'];
  if(capabilities.approveReplace)explanation.splice(3,0,'Schválit a nahradit otevře potvrzení nahrazení.');if(capabilities.reject)explanation.splice(capabilities.approveReplace?4:3,0,'Zamítnutí odstraní jen review kopii.');for(const text of explanation)help.append(make('p','details',text));
  const list=make('ul');
  for(const [key,label]of [['Space / K','Přehrát nebo pozastavit'],['A','Zvuk originál ↔ převod'],['W','Dělicí čára: 50 %, automaticky, vypnuto'],['← / →','Posunout o 1 sekundu'],['[ / ]','Předchozí nebo další úsek'],['1 · 2 · 3','Potvrdit obraz, zvuk, synchronizaci úseku'],['Enter','Potvrdit nepotvrzené v úseku a pokračovat'],['R','Přehrát úsek znovu'],['X',capabilities.reject?'Problém: poznámka, odložení, zamítnutí':'Problém: poznámka nebo odložení'],['S','Schválit'],...(capabilities.approveReplace?[['Shift+S','Schválit a nahradit']]:[]),...(capabilities.reject?[['Z','Zamítnout']]:[]),...(capabilities.next?[['N','Další film']]:[]),['T','Stopy a časy'],['F','Celá obrazovka'],['M','Ztlumit'],['H','Skrýt nebo zobrazit překryv'],['?','Nápověda'],['Esc','Zavřít; potom zobrazit detail filmu'],...(hdrRequired?[['D','Potvrdit HDR/Dolby Vision na zařízení']]:[])]){const li=make('li');li.append(make('kbd','',key),make('span','',label));list.append(li)}
  help.append(list);
 }
 function render(){
  if(dead)return;
  position.textContent=(segment+1)+' / 3 · '+tr(SEGMENT_TITLES[segment])+' · '+clock(excerpts()[segment]);
  pairLine.textContent=pairText();
  chips.replaceChildren();
  for(const [key,label]of [['preparation','Příprava'],['image','Obraz'],...(hdrRequired?[['hdr','HDR']]:[]),['audio','Zvuk'],['syncStart','Sync 1'],['syncMiddle','Sync 2'],['syncEnd','Sync 3']]){const chip=make('li','',label);chip.dataset.reviewCheck=key;chip.dataset.state=checkState(key);chip.title=tr({empty:'Nepotvrzeno',confirmed:'Potvrzeno, ukládá se',saved:'Uloženo'}[chip.dataset.state]);chips.append(chip)}
  for(const node of prompt.querySelectorAll('[data-chip]')){const key=checkKey(node.dataset.chip);node.dataset.state=checkState(key);node.setAttribute('aria-pressed',String(state.session.checks[key]===true))}
  saved.textContent=tr(state.conflict?'! Neuloženo':state.saving?'○ Ukládám…':state.dirty?'○ Neuloženo':state.revision>0?'● Uloženo':'');saved.dataset.state=state.conflict?'conflict':state.saving||state.dirty?'pending':'saved';
  root.dataset.overlay=hidden?'hidden':'shown';renderDeferState();
 }
 function onKeydown(event){
  if(dead||event.defaultPrevented||event.isComposing||event.ctrlKey||event.altKey||event.metaKey)return;
  const key=event.key;
  if(key==='Escape'){
   if(!help.hidden)setHelp(false);else if(overlay==='problem')show(after());else if(player?.optionsOpen)toggleOptions(false);else onChrome(true);
   event.preventDefault();event.stopPropagation();return;
  }
  if(editable(event.target)&&!(key==='Enter'&&event.target===deviceInput))return;
  if(event.repeat&&!['ArrowLeft','ArrowRight'].includes(key))return;
  const lower=key.length===1?key.toLowerCase():key,now=player?.snapshot?.()||playback;
  switch(lower){
   case ' ':case 'k':if(overlay==='resume')play(segment);else if(overlay!=='start')void command('toggle');break;
   case 'a':void command('listen');break;
   case 'w':player?.setWipeMode({half:'auto',auto:'off',off:'half'}[player.wipeMode]||'half');break;
   case 'ArrowLeft':void command('seek',Math.max(0,(Number(now.position)||0)-1));break;
   case 'ArrowRight':void command('seek',Math.min(Number(now.duration)||0,(Number(now.position)||0)+1));break;
   case '[':play(segment-1);break;
   case ']':play(segment+1);break;
   case '1':case '2':case '3':if(['segment','none'].includes(overlay))toggleCheck(CHIP_KEYS[Number(lower)-1][0]);break;
   case 'd':if(hdrRequired&&overlay==='decision'&&state.session.checks.hdr!==true){onConfirm(['hdr'],segment);render()}break;
   case 'Enter':if(overlay==='start')start();else if(overlay==='resume')play(segment);else if(overlay==='segment')confirmSegment();else return;break;
   case 'r':play(segment);break;
   case 'x':show('problem');break;
   case 's':if(overlay==='decision'){const node=prompt.querySelector(event.shiftKey?'[data-workflow-approve]':'[data-workflow-approve-only]');if(node&&!node.disabled)node.onclick()}break;
   case 'z':if(capabilities.reject)onReject();else return;break;
   case 'n':if(capabilities.next)onNext();else return;break;
   case 't':toggleOptions();break;
   case 'f':if(doc.fullscreenElement===root)void doc.exitFullscreen?.();else void root.requestFullscreen?.()?.catch?.(()=>{});break;
   case 'm':void command('mute');break;
   case 'h':hidden=!hidden;render();break;
   case '?':setHelp(help.hidden);break;
   default:return;
  }
  event.preventDefault();
 }
 root.addEventListener('keydown',onKeydown);
 const focusRoot=event=>{if(!event.target.closest?.('button,input,select,textarea,summary,a,[role="slider"]'))root.focus({preventScroll:true})};root.addEventListener('pointerdown',focusRoot);
 renderHelp();
 const resume=resumePoint(session.checks);segment=resume.segment;void command('excerpt',{index:segment,play:false});show(resume.prompt);
 void Promise.resolve().then(()=>{if(!dead)(deviceInput||root).focus?.({preventScroll:true})});
 return {
  refresh(next={}){state={...state,...next,session:next.session||state.session,baseline:next.baseline||state.baseline};render()},
  get overlay(){return overlay},get segment(){return segment},
  destroy(){if(dead)return;dead=true;root.removeEventListener('keydown',onKeydown);root.removeEventListener('pointerdown',focusRoot);cleanup?.();root.replaceChildren();host.replaceChildren()}
 };
}
