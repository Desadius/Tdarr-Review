const text=(node,value)=>{node.textContent=value;return node};
let nextHelpId=0;
const formatTime=value=>{
 const seconds=Number.isFinite(Number(value))?Math.max(0,Math.floor(Number(value))):0;
 return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
};
const canSeek=state=>Number.isFinite(state.duration)&&state.duration>0;
const unavailable=state=>['preparing','closed','disabled'].includes(state.status);

/** Mounts one toolbar and workspace-scoped keyboard handler around a shared player controller. */
export function mountPlayerControls(host,controller,{tr=value=>value,onFullscreen=()=>{},onFocus=()=>{},onView=()=>{},onWipe=()=>{},onEscape=()=>false}={}){
 const helpId=`player-controls-help-${++nextHelpId}`;
 const doc=host.ownerDocument||document,root=doc.createElement('div');root.className='player-controls-dock';root.dataset.dock='bottom';
 const toolbar=doc.createElement('section');toolbar.className='player-controls';toolbar.setAttribute('role','region');toolbar.setAttribute('aria-label',tr('Ovládání přehrávání'));
 const primary=doc.createElement('div');primary.className='player-controls-primary';
 const status=doc.createElement('output');status.className='player-controls-status';status.setAttribute('aria-live','off');
 const more=doc.createElement('details');more.className='player-controls-more';const moreSummary=doc.createElement('summary');text(moreSummary,tr('Další ovládání'));moreSummary.setAttribute('aria-label',tr('Další ovládání'));more.append(moreSummary);
 const help=doc.createElement('section');help.className='player-controls-help';help.setAttribute('role','dialog');help.setAttribute('aria-modal','false');help.setAttribute('aria-label',tr('Klávesové zkratky přehrávače'));help.hidden=true;
 const helpTitle=doc.createElement('h3');helpTitle.id=helpId;text(helpTitle,tr('Klávesové zkratky přehrávače'));help.setAttribute('aria-labelledby',helpTitle.id);help.append(helpTitle);
 const helpClose=doc.createElement('button');helpClose.type='button';helpClose.dataset.action='help-close';helpClose.setAttribute('aria-label',tr('Zavřít nápovědu'));text(helpClose,tr('Zavřít'));help.append(helpClose);
 const helpList=doc.createElement('ul');
 for(const [key,label] of [['Space / K','Přehrát nebo pozastavit'],['← / →','Posunout o 1 sekundu'],['M','Ztlumit nebo zapnout zvuk'],['F','Celá obrazovka'],['H','Skrýt nebo zobrazit ovládání'],['?','Zobrazit nápovědu'],['[ / ]','Předchozí nebo další ukázka'],['R','Znovu přehrát aktuální ukázku'],['S','Zastavit přehrávání'],['Escape','Zavřít nápovědu; potom celou obrazovku nebo režim zaostření']]){const row=doc.createElement('li'),keyNode=doc.createElement('kbd'),description=doc.createElement('span');text(keyNode,key);text(description,tr(label));row.append(keyNode,description);helpList.append(row)}
 help.append(helpList);
 const restore=doc.createElement('button');restore.type='button';restore.className='player-controls-restore';restore.dataset.action='restore';restore.setAttribute('aria-label',tr('Zobrazit ovládání přehrávání'));restore.title=tr('Zobrazit ovládání přehrávání');text(restore,'▶');restore.hidden=true;
 let lastFocus=null,helpOpen=false,currentState=controller.snapshot(),destroyed=false;
 const buttons=new Map(),removeListeners=[];
 const listen=(node,type,handler)=>{node.addEventListener(type,handler);removeListeners.push(()=>node.removeEventListener(type,handler))};
 function button(action,label,onClick,{container=primary,pressed}={}){
  const node=doc.createElement('button');node.type='button';node.dataset.action=action;node.setAttribute('aria-label',tr(label));node.title=tr(label);text(node,tr(label));
  if(pressed!==undefined)node.setAttribute('aria-pressed',String(pressed));listen(node,'click',onClick);container.append(node);buttons.set(action,node);return node;
 }
 const play=button('play','Přehrát',()=>controller.command('toggle'));
 const stop=button('stop','Zastavit',()=>controller.command('stop'),{container:more});
 const previous=button('previous','Předchozí ukázka',()=>controller.command('previous'));
 const next=button('next','Další ukázka',()=>controller.command('next'));
 const repeat=button('repeat','Znovu přehrát aktuální ukázku',()=>controller.command('repeat'),{container:more});
 const seekLabel=doc.createElement('label');seekLabel.className='player-controls-seek-label';text(seekLabel,tr('Pozice přehrávání'));
 const seek=doc.createElement('input');seek.type='range';seek.min='0';seek.step='0.1';seek.dataset.action='seek';seek.setAttribute('aria-label',tr('Pozice přehrávání'));seekLabel.append(seek);listen(seek,'input',()=>controller.command('seek',Number(seek.value)));primary.append(seekLabel);
 const volumeLabel=doc.createElement('label');volumeLabel.className='player-controls-volume-label';text(volumeLabel,tr('Hlasitost'));
 const volume=doc.createElement('input');volume.type='range';volume.min='0';volume.max='1';volume.step='0.05';volume.dataset.action='volume';volume.setAttribute('aria-label',tr('Hlasitost'));volumeLabel.append(volume);primary.append(volumeLabel);
 listen(volume,'input',()=>controller.command('volume',Number(volume.value)));
 const mute=button('mute','Vypnout zvuk',()=>controller.command('mute',!currentState.muted),{pressed:!!currentState.muted});
 const routing=button('routing','Oddělené uši',()=>controller.command('routing',{mode:currentState.routing==='ears'?'sequential':'ears',swapEars:!!currentState.swapEars}),{container:more});
 const swapEars=button('swap-ears','Prohodit levý a pravý kanál',()=>controller.command('routing',{mode:currentState.routing,swapEars:!currentState.swapEars}),{container:more});
 primary.append(status);
 const hide=button('hide','Skrýt ovládání',()=>setHidden(true),{container:more});
 const dock=button('dock','Přesunout ovládání nahoru',()=>{root.dataset.dock=root.dataset.dock==='bottom'?'top':'bottom';render(currentState)},{container:more});
 const fullscreen=button('fullscreen','Celá obrazovka',()=>onFullscreen());
 const focus=button('focus','Režim zaostření',()=>onFocus(),{container:more});
 const view=button('view','Změnit zobrazení porovnání',()=>onView(),{container:more});
 const wipe=button('wipe','Režim stírání',()=>onWipe(),{container:more});
 const helpButton=button('help','Klávesové zkratky',()=>setHelp(true));
 toolbar.append(primary,more,help);root.append(toolbar,restore);host.append(root);
 listen(restore,'click',()=>setHidden(false));
 listen(helpClose,'click',()=>setHelp(false));

 function setHidden(value){
  toolbar.hidden=value;restore.hidden=!value;
  if(value){if(helpOpen)setHelp(false);lastFocus=doc.activeElement===toolbar||toolbar.contains(doc.activeElement)?doc.activeElement:hide;restore.focus()}
  else (lastFocus?.isConnected!==false?lastFocus:hide).focus();
 }
 function setHelp(value){
  helpOpen=value;help.hidden=!value;
  if(value)helpClose.focus();else helpButton.focus();
 }
 function render(nextState){
  if(destroyed)return;currentState={...nextState};const unavailableState=unavailable(currentState);
  const playing=currentState.status==='playing';play.dataset.icon=playing?'Ⅱ':'▶';play.textContent=tr(playing?'Pozastavit':'Přehrát');play.setAttribute('aria-label',tr(playing?'Pozastavit':'Přehrát'));play.title=tr(playing?'Pozastavit':'Přehrát');play.disabled=unavailableState;
  const phaseLabels={original:'Originál',together:'Společné',transcode:'Převod'};
  const excerpt=currentState.excerptCount?`${Number(currentState.excerptIndex??0)+1} ${tr('z')} ${currentState.excerptCount}`:tr('Bez ukázky');
  const phase=phaseLabels[currentState.phase]||tr('Přehrávač');
  const remaining=Math.max(0,(Number(currentState.duration)||0)-(Number(currentState.position)||0));
  const routingLabel=tr(currentState.routing==='sequential'?'Po sobě · obě uši':currentState.swapEars?'Prohozené uši':'Oddělené uši');
  status.textContent=`${tr('Ukázka')} ${excerpt} · ${tr(phase)} · ${routingLabel} · ${formatTime(currentState.position)} / ${formatTime(currentState.duration)} · ${tr('Zbývá')} ${formatTime(remaining)} · ${tr('Relace')} ${formatTime(currentState.elapsed)} / ${formatTime(currentState.totalDuration)} · ${tr('Zdroj')} ${formatTime(currentState.sourceTime)}`;
  seek.max=String(Math.max(0,Number(currentState.duration)||0));seek.value=String(Math.min(Math.max(0,Number(currentState.position)||0),Number(currentState.duration)||0));seek.disabled=!canSeek(currentState)||unavailableState;
  volume.value=String(Math.min(1,Math.max(0,Number(currentState.volume)||0)));mute.textContent=tr(currentState.muted?'Zapnout zvuk':'Vypnout zvuk');mute.setAttribute('aria-label',tr(currentState.muted?'Zapnout zvuk':'Vypnout zvuk'));mute.setAttribute('aria-pressed',String(!!currentState.muted));
  routing.textContent=routingLabel;routing.setAttribute('aria-label',tr(currentState.routing==='sequential'?'Přepnout na oddělené uši':'Přepnout na porovnání po sobě'));
  previous.disabled=Number(currentState.excerptIndex)<=0;next.disabled=Number(currentState.excerptIndex)>=Number(currentState.excerptCount)-1;swapEars.textContent=tr(currentState.swapEars?'Vrátit pořadí kanálů':'Prohodit levý a pravý kanál');swapEars.setAttribute('aria-pressed',String(!!currentState.swapEars));
  play.disabled=unavailableState;seek.disabled=!canSeek(currentState)||unavailableState;volume.disabled=unavailableState;mute.disabled=unavailableState;routing.disabled=unavailableState;swapEars.disabled=unavailableState;previous.disabled=unavailableState||previous.disabled;next.disabled=unavailableState||next.disabled;repeat.disabled=unavailableState;
  stop.disabled=currentState.status==='idle'||currentState.status==='ended'||unavailableState;fullscreen.disabled=false;focus.disabled=false;view.disabled=false;wipe.disabled=false;
  dock.textContent=tr(root.dataset.dock==='bottom'?'Přesunout ovládání nahoru':'Přesunout ovládání dolů');dock.setAttribute('aria-label',dock.textContent);
 }
 function isEditable(target){
  if(!target)return false;
  if(target.isContentEditable)return true;
  return !!target.closest?.('input, textarea, select, button, a, [contenteditable="true"], [role="slider"], [role="button"], [type="checkbox"]');
 }
 function isTextEntry(target){return !!target?.isContentEditable||!!target?.closest?.('input:not([type="range"]), textarea, select, [contenteditable="true"]')}
 function onKeydown(event){
  if(destroyed||event.defaultPrevented||event.isComposing||event.repeat||event.ctrlKey||event.altKey||event.metaKey||(event.shiftKey&&event.key!=='?'))return;
  const key=event.key?.toLowerCase();let action,value;
  if(key==='escape'){
   if(helpOpen){setHelp(false);event.preventDefault();event.stopPropagation();return}
   if((doc.activeElement===host||host.contains(doc.activeElement))&&onEscape({editable:isTextEntry(event.target)})===true){event.preventDefault();event.stopPropagation()}
   return;
  }
  const restoreShortcut=key==='h'&&doc.activeElement===restore;
  if((isEditable(event.target)&&!restoreShortcut)||(doc.activeElement!==host&&!restoreShortcut))return;
  switch(key){
   case ' ':case 'k':action='toggle';break;
   case 'arrowleft':action='seek';value=Math.max(0,(Number(currentState.position)||0)-1);break;
   case 'arrowright':action='seek';value=Math.min(Number(currentState.duration)||0,(Number(currentState.position)||0)+1);break;
   case 'm':action='mute';value=!currentState.muted;break;
   case 'f':action='fullscreen';break;
   case 'h':setHidden(!toolbar.hidden);break;
   case '?':setHelp(true);break;
   case '[':action='previous';break;
   case ']':action='next';break;
   case 'r':action='repeat';break;
   case 's':action='stop';break;
   default:return;
  }
  event.preventDefault();
  if((action==='toggle'&&play.disabled)||(action==='stop'&&stop.disabled)||(action==='previous'&&previous.disabled)||(action==='next'&&next.disabled)||(action==='seek'&&(!canSeek(currentState)||unavailable(currentState))))return;
  if(action==='fullscreen')onFullscreen();else if(action)controller.command(action,value);
 }
 host.addEventListener('keydown',onKeydown);
 const unsubscribe=controller.subscribe(render);
 render(currentState);
 return ()=>{
  if(destroyed)return;destroyed=true;host.removeEventListener('keydown',onKeydown);unsubscribe?.();for(const remove of removeListeners)remove();
  root.remove?.();if(root.parentElement)root.parentElement.removeChild(root);
 };
}
