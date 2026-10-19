// Frame and audio/AV comparison dialogs. The app context supplies api() and the latest item list.
import {mountAVComparison} from '/av-player.js?v=__APP_VERSION__';
import {preparationSummary,previewJobMatches,createCachedPreviewLoader} from '/review-workflow.js?v=__APP_VERSION__';
import {tr,translateAudioTrackLabel as audioTrackLabel} from '/i18n.js?v=__APP_VERSION__';
import {el,button,elapsedText} from '/ui-kit.js?v=__APP_VERSION__';

let app=null;
const api=(route,body)=>app.api(route,body);

function pendingPreviewMessage(preparation,request){const job=preparation?.jobs?.find(x=>previewJobMatches(x,request)),waiting=job&&job.status!=='error'&&!['disabled','unavailable'].includes(preparation.state);return preparationSummary(preparation,tr)+' · '+tr(waiting?'Hotová ukázka se načte automaticky. Jiný úsek vytvoř tlačítkem.':'Pro vybraný úsek není hotová ukázka. Vytvoř ji tlačítkem.')}

let compareDialog=null,compareCleanup=null,audioDialog=null,audioCleanup=null;
export function installComparisons(context){
 app=context;
 compareDialog=el('dialog','comparison');document.body.append(compareDialog);
 compareDialog.addEventListener('close',()=>{compareCleanup?.();compareCleanup=null;compareDialog.replaceChildren()});
 audioDialog=el('dialog','comparison');document.body.append(audioDialog);
 audioDialog.addEventListener('close',()=>{audioCleanup?.();audioCleanup=null;audioDialog.replaceChildren()});
}
export function openComparison(item,options={}){
 const host=options.host||compareDialog;let dead=false,request=0,cachedLoader=null;host.replaceChildren();
 const current=()=>!dead&&host.isConnected&&app.latest?.items.some(x=>x.id===item.id&&x.snapshot===item.snapshot);
 const cleanup=()=>{dead=true;request++;cachedLoader?.stop();host.replaceChildren()};if(!options.host){compareCleanup?.();compareCleanup=cleanup}
 const heading=el('div','comparison-head'),close=button('Zavřít',()=>compareDialog.close());heading.append(el('h2','',item.title,true),close);
 const note=el('p','','Snímky ve stejném čase, PNG bez další ztrátové komprese. Porovnání je statické, bez zvuku.');
 const controls=el('form','comparison-controls'),label=el('label','','Čas ve filmu (sekundy)'),time=el('input');time.type='number';time.min='0';time.step='0.001';time.max=String(Math.max(0,Math.min(item.durationA,item.durationB)-1));time.value=String(Math.min(Number(time.max),options.scope?.seconds??Math.min(300,Math.floor(Number(time.max)/2))));label.append(time);
 const go=el('button','','Načíst oba snímky'),zoom=button('Zvětšení 1 : 1',()=>{enlarged=!enlarged;pair.classList.toggle('actual-size',enlarged);zoom.textContent=tr(enlarged?'Přizpůsobit šířce':'Zvětšení 1 : 1')});
 const status=el('p','comparison-status','Vyber čas a načti snímky.');status.setAttribute('role','status');const pair=el('div','comparison-pair');let enlarged=false;
 controls.append(label,go,zoom);
 const canInteract=()=>current()&&(options.canInteract?.()??true),validTime=()=>time.value.trim()!==''&&time.validity.valid&&Number.isFinite(Number(time.value))&&Number(time.value)>=0&&Number(time.value)<=Number(time.max);
 const scopeChanged=()=>{if(!canInteract())return;cachedLoader?.stop();const valid=validTime();options.onScopeValidityChange?.(valid);if(valid)options.onScopeChange?.({...options.scope,seconds:Number(time.value)});request++;pair.replaceChildren();status.textContent=tr('Vyber čas a načti snímky.');go.dataset.previewInvalid=String(!valid);go.disabled=!valid};time.oninput=time.onchange=scopeChanged;
 const presets=el('div','comparison-controls');for(const percent of [10,30,50,70,90])presets.append(button(percent+' % filmu',()=>{time.value=String(Math.floor(Number(time.max)*percent/100));scopeChanged();controls.requestSubmit()}));
 for(const control of [time,go,...presets.querySelectorAll('button')])control.dataset.previewControl='';const setBusy=value=>{controls.dataset.previewBusy=String(value);for(const control of [time,go,...presets.querySelectorAll('button')]){control.dataset.previewBusy=String(value);control.disabled=value||!canInteract()||control.dataset.previewInvalid==='true'}};
 function renderFrames(d){
  pair.replaceChildren();const panes=[];for(const [key,title]of [['original','Originál'],['review','Překódovaný výsledek']]){const figure=el('figure'),pane=el('div','frame-scroll'),img=el('img');img.alt=tr(title+' v čase '+elapsedText(d.seconds));img.src='data:image/png;base64,'+d[key];pane.append(img);figure.append(el('figcaption','',title),pane);pair.append(figure);panes.push(pane)}
  let sync=false;for(const [i,pane]of panes.entries())pane.onscroll=()=>{if(sync)return;sync=true;panes[1-i].scrollLeft=pane.scrollLeft;panes[1-i].scrollTop=pane.scrollTop;requestAnimationFrame(()=>{sync=false})};
  status.textContent=tr('Hotové snímky jsou načtené.')+' '+tr('Čas ve filmu (sekundy)')+': '+Number(d.seconds).toFixed(2)+' · '+tr(d.hdr?'HDR převedeno shodně do SDR pro náhled. Věrnost HDR ověř na TV.':'Plné rozlišení snímků; detaily porovnej ve zvětšení 1 : 1.');
 }
 controls.onsubmit=async e=>{e.preventDefault();if(go.disabled||!canInteract()||!validTime())return;scopeChanged();const generation=++request;setBusy(true);pair.replaceChildren();status.textContent=tr('Připravuji oba snímky na serveru… Obvykle několik sekund, nejvýše dvě minuty.');
  try{await options.beforePreview?.();if(!current())return;const d=await api('/api/items/'+item.id+'/frames',{snapshot:item.snapshot,seconds:Number(time.value)});if(!current()||generation!==request)return;if(d.pending){options.onPreparation?.(d.preparation);status.textContent=preparationSummary(d.preparation,tr);return}renderFrames(d)}
  catch(e){if(current()&&generation===request)status.textContent=tr(e.message)}finally{if(current()&&generation===request)setBusy(false)}
 };
 host.append(...(options.host?[]:[heading]),note,controls,presets,status,pair);if(!options.host){compareDialog.setAttribute('aria-label',tr('Porovnání obrazu · '+item.title));compareDialog.showModal()}
 if(options.cachedAutoLoad){void Promise.resolve().then(()=>{if(!current()||!validTime())return;const generation=request;
  cachedLoader=createCachedPreviewLoader({current:()=>current()&&generation===request,load:body=>api('/api/items/'+item.id+'/frames',body),readPreparation:()=>api('/api/items/'+item.id+'/preview-status?snapshot='+encodeURIComponent(item.snapshot)),onPreparation:options.onPreparation,onPending:(d,body)=>status.textContent=pendingPreviewMessage(d.preparation,body),onReady:renderFrames,onError:e=>status.textContent=tr(e.message)});
  cachedLoader.start([{snapshot:item.snapshot,mode:'frames',seconds:Number(time.value)}]);
 })}else if(options.autoLoad!==false)controls.requestSubmit();return cleanup;
}
export function openAudioComparison(item,options={}){
 const host=options.host||audioDialog;let dead=false,generation=0,working=false,abPlayer=null,avCleanup=null,prepared=null,preparedIdentity=null,trackReady=false,cachedLoader=null,preparation=options.preparation;host.replaceChildren();
 const current=()=>!dead&&host.isConnected&&app.latest?.items.some(x=>x.id===item.id&&x.snapshot===item.snapshot);
 const cleanup=()=>{dead=true;generation++;cachedLoader?.stop();abPlayer?.close();abPlayer=null;avCleanup?.();avCleanup=null;host.replaceChildren()};if(!options.host){audioCleanup?.();audioCleanup=cleanup}
 const head=el('div','comparison-head'),close=button('Zavřít',()=>audioDialog.close());head.append(el('h2','',item.title+' — porovnání zvuku'),close);
 const note=el('p','details','Porovnej stejný jazyk i verzi zvuku (nikoli dabing s originálem nebo komentářem). Grafy ukazují hlasitost v krocích 10 ms na stejné časové ose, nikoli kvalitu zvuku. Odhad hledá posun do ±1 sekundy. Neověřuje soulad řeči s pohybem úst.');
 const form=el('form','comparison-controls'),a=el('select'),b=el('select'),time=el('input'),profile=el('select');time.type='number';time.min='0';time.max=String(Math.max(0,Math.min(item.durationA,item.durationB)-12));time.step='0.01';time.value=String(Math.min(Number(time.max),options.scope?.seconds??Math.min(300,Math.floor(Number(time.max)/2))));
 profile.append(new Option(tr('Rychlý náhled · nejvýše 960 × 540'),'compact'),new Option(tr('Detailnější náhled · nejvýše 1920 × 1080'),'detail'));profile.value=options.previewProfile||'compact';profile.setAttribute('aria-label',tr('Kvalita videonáhledu'));
 for(const [title,input]of [['Stopa originálu',a],['Stopa převodu',b],['Začátek úseku (sekundy)',time]]){const label=el('label','',title);label.append(input);form.append(label)}
 const go=button('Porovnat 12 sekund',()=>prepare('wave')),avButton=button('Porovnat video a zvuk',()=>prepare('av'),'primary'),listen=button('Přehrát A/B do sluchátek',()=>prepare('listen'),'primary'),stop=button('Zastavit',()=>{generation++;cachedLoader?.stop();abPlayer?.stop();setWorking(false);status.textContent=tr('Poslech zastaven.')}),repeat=button('Opakovat A/B',()=>play().catch(e=>status.textContent=tr(e.message))),volume=el('input');
 const status=el('p','comparison-status','Načítám seznam zvukových stop…');status.setAttribute('role','status');const plot=el('div'),avHost=el('div','av-host');
 // A failed video+audio sample offers the existing external-player review; switching resets the checks
 // by the workflow's own rules. Producing or failing a sample never confirms anything (#183).
 const fallback=el('div','comparison-controls');fallback.hidden=true;
 const offerExternal=()=>{if(!options.onExternalReview||!fallback.hidden)return;fallback.replaceChildren(el('p','details','Ukázku videa se zvukem nyní nejde připravit. Film můžeš posoudit ve vlastním přehrávači; potvrzené kontroly se tím zruší a poznámka zůstane.'),button('Posoudit ve vlastním přehrávači',()=>{if(canInteract())options.onExternalReview()}));fallback.hidden=false};
 const withdrawExternal=()=>{fallback.hidden=true;fallback.replaceChildren()};
 const audioControls=el('div','comparison-controls'),volumeLabel=el('label','','Společná hlasitost');volume.type='range';volume.min='0';volume.max='1';volume.step='.05';volume.value='.5';volume.setAttribute('aria-label',tr('Společná hlasitost obou ukázek'));volumeLabel.append(volume);audioControls.append(listen,repeat,stop,volumeLabel);
 volume.oninput=()=>{if(abPlayer)abPlayer.gain.gain.value=Number(volume.value)};
 const selectedScope=()=>({...options.scope,seconds:Number(time.value),originalIndex:a.value===''?null:Number(a.value),reviewIndex:b.value===''?null:Number(b.value)});
 const scopeIdentity=()=>JSON.stringify(selectedScope()),previewIdentity=()=>JSON.stringify({...selectedScope(),previewProfile:profile.value});
 const canInteract=()=>current()&&(options.canInteract?.()??true),validTime=()=>time.value.trim()!==''&&time.validity.valid&&Number.isFinite(Number(time.value))&&Number(time.value)>=0&&Number(time.value)<=Number(time.max);let lastScope=null;
 const presets=el('div','comparison-controls');
 const setWorking=value=>{working=value;form.dataset.previewBusy=String(value);for(const x of [go,avButton,listen,repeat,a,b,time,profile,...presets.querySelectorAll('button')]){x.dataset.previewControl='';x.dataset.previewBusy=String(value);x.dataset.previewInvalid=String([go,avButton,listen].includes(x)?!trackReady||!validTime():x===repeat?!prepared:false);x.disabled=value||!canInteract()||x.dataset.previewInvalid==='true'}};
 const observePreparation=value=>{if(value?.snapshot!==item.snapshot)return;preparation=value;options.onPreparation?.(value)};
 const invalidate=()=>{if(working||!canInteract())return;const valid=validTime();options.onScopeValidityChange?.(valid);const scope=valid?selectedScope():null,key=scope?previewIdentity():null;if(valid&&key===lastScope)return;lastScope=key;generation++;cachedLoader?.stop();abPlayer?.stop();prepared=null;preparedIdentity=null;avCleanup?.();avCleanup=null;avHost.replaceChildren();plot.replaceChildren();status.textContent=tr('Vyber odpovídající stopy a připrav ukázku.');if(valid)options.onScopeChange?.(scope);setWorking(false)};
 time.addEventListener('input',invalidate);for(const input of [time,a,b,profile])input.addEventListener('change',invalidate);
 for(const [name,percent]of [['Začátek filmu',2],['Střed filmu',50],['Konec filmu',95]])presets.append(button(name,()=>{if(working||!canInteract())return;
  const times=[...new Set((preparation?.jobs||[]).filter(x=>x.mode==='av'&&x.previewProfile==='compact'&&x.originalIndex===Number(a.value)&&x.reviewIndex===Number(b.value)).map(x=>x.seconds).filter(Number.isFinite))].sort((x,y)=>x-y);
  time.value=String(times.length>=3?times[percent<10?0:percent>90?times.length-1:Math.floor(times.length/2)]:Math.floor(Number(time.max)*percent/100));invalidate();if(options.cachedAutoLoad)startAutomatic();
 }));
 async function ensurePlayer(){const AudioCtor=window.AudioContext||window.webkitAudioContext;if(!AudioCtor)throw Error('Prohlížeč nepodporuje zvukové A/B.');if(!abPlayer){abPlayer=new AudioABPlayer(new AudioCtor());abPlayer.gain.gain.value=Number(volume.value)}await abPlayer.context.resume()}
 const play=async()=>{if(!canInteract()||!prepared||preparedIdentity!==scopeIdentity())return;const captured=prepared,attempt=generation;await ensurePlayer();if(!current()||attempt!==generation||captured!==prepared)return;
  const durations=abPlayer.play(captured.original,captured.review,()=>{if(current()&&attempt===generation)status.textContent=tr('A/B dokončeno. Můžeš úsek opakovat.')});status.textContent=tr('Přehrávám připravené A/B ukázky.')+' '+Number(captured.seconds).toFixed(2)+' s · '+audioTrackLabel(captured.originalTrack.label)+' → '+audioTrackLabel(captured.reviewTrack.label);
 };
 function renderPayload(mode,d){
  if(mode==='av'){avCleanup?.();avHost.replaceChildren(el('p','',audioTrackLabel(a.selectedOptions[0]?.textContent||'')+' → '+audioTrackLabel(b.selectedOptions[0]?.textContent||''),true));plot.replaceChildren();avCleanup=mountAVComparison(avHost,d,{tr});status.textContent=tr('Video i zvuk jsou připravené. Vybrané stopy a čas jsou pevné pro tuto ukázku.')}
  else if(mode==='listen'){prepared=d;preparedIdentity=scopeIdentity();setWorking(false)}
  else{plot.replaceChildren();const canvas=el('canvas');canvas.width=1100;canvas.height=310;canvas.style.width='100%';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',tr('Zvukové průběhy originálu a převodu na společné časové ose'));plot.append(canvas);const ctx=canvas.getContext('2d');ctx.fillStyle='#111827';ctx.fillRect(0,0,1100,310);const max=Math.max(.001,...d.original,...d.review);
   for(const [values,title,color,base]of [[d.original,'Originál','#38bdf8',120],[d.review,'Převod','#fbbf24',250]]){ctx.fillStyle=color;ctx.font='16px sans-serif';ctx.fillText(tr(title),12,base-80);ctx.strokeStyle=color;ctx.beginPath();values.forEach((v,i)=>{const x=85+i/1200*990,y=base-v/max*65;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke()}
   ctx.fillStyle='#d1d5db';ctx.font='13px sans-serif';for(let i=0;i<=12;i+=2){const x=85+i/12*990;ctx.strokeStyle='#374151';ctx.beginPath();ctx.moveTo(x,45);ctx.lineTo(x,260);ctx.stroke();ctx.fillText((d.seconds+i).toFixed(1)+' s',x-20,285)}
   const r=d.alignment;status.textContent=tr(r.reliable?'Posun mezi zvukovými stopami (ms):':'Posun zvuku nelze spolehlivě určit.')+(r.reliable?' '+r.offsetMs:'');
  }
 }
 function startAutomatic(){
  if(!options.cachedAutoLoad||working||!trackReady||!validTime()||!current())return;cachedLoader?.stop();const identity=previewIdentity(),attempt=generation,modes=options.mode==='audio'?['wave','listen']:['av'];
  cachedLoader=createCachedPreviewLoader({current:()=>current()&&attempt===generation&&identity===previewIdentity(),load:body=>api('/api/items/'+item.id+'/audio-compare',body),readPreparation:()=>api('/api/items/'+item.id+'/preview-status?snapshot='+encodeURIComponent(item.snapshot)),onPreparation:observePreparation,onPending:(d,request)=>status.textContent=pendingPreviewMessage(d.preparation,request),onReady:(d,request)=>{renderPayload(request.mode,d);status.textContent=tr('Hotová ukázka je načtená. Přehrávání spusť ručně.');setWorking(false)},onError:e=>status.textContent=tr(e.message)});
  cachedLoader.start(modes.map(mode=>({snapshot:item.snapshot,...selectedScope(),mode,...(mode==='av'?{previewProfile:profile.value}:{})})));
 }
 async function prepare(mode){
  if(working||!trackReady||!canInteract()||!validTime())return;
  if(mode==='listen'&&prepared&&preparedIdentity===scopeIdentity()){try{await play()}catch(e){if(current())status.textContent=tr(e.message)}return}
  const attempt=++generation;cachedLoader?.stop();withdrawExternal();lastScope=previewIdentity();options.onScopeValidityChange?.(true);options.onScopeChange?.(selectedScope());setWorking(true);abPlayer?.stop();avCleanup?.();avCleanup=null;plot.replaceChildren();avHost.replaceChildren();
  try{if(mode==='listen')await ensurePlayer();status.textContent=tr(mode==='av'?'Připravuji dvě videa a zvukové průběhy. Příprava může trvat až čtyři minuty.':mode==='listen'?'Připravuji dvě 12sekundové ukázky; nejvýše dvě minuty.':'Připravuji zvukové průběhy… Nejvýše dvě minuty.');
   await options.beforePreview?.();if(!current()||attempt!==generation)return;const capture={snapshot:item.snapshot,...selectedScope()},d=await api('/api/items/'+item.id+'/audio-compare',{...capture,...(mode==='wave'?{}:{mode}),...(mode==='av'?{previewProfile:profile.value}:{})});if(!current()||attempt!==generation)return;
   if(d.pending){observePreparation(d.preparation);status.textContent=pendingPreviewMessage(d.preparation,{...capture,mode,previewProfile:profile.value});return}
   renderPayload(mode,d);if(mode==='listen')await play();
  }catch(e){if(current()&&attempt===generation){status.textContent=tr(e.message);if(mode==='av')offerExternal()}}finally{if(current()&&attempt===generation)setWorking(false)}
 }
 form.onsubmit=e=>{e.preventDefault();prepare(options.mode==='av'?'av':'wave')};
 const showAV=options.mode!=='audio',showAudio=options.mode!=='av';if(showAV){const label=el('label','','Kvalita videonáhledu');label.append(profile);form.append(label,avButton)}if(showAudio)form.append(go);
 host.append(...(options.host?[]:[head]),note,form,presets,status,fallback);if(showAudio)host.append(el('p','details','Sluchátka: nejprve originál vlevo, potom stejný úsek převodu vpravo. Obě stopy se převedou na mono 48 kHz. Bez samostatné normalizace hlasitosti a bez automatického posunu; použij odpovídající dialogové stopy.'),audioControls);host.append(avHost,plot);
 if(!options.host){audioDialog.setAttribute('aria-label',tr('Porovnání zvuku · '+item.title));audioDialog.showModal()}setWorking(false);
 (async()=>{try{await Promise.resolve();const data=options.tracks||await api('/api/items/'+item.id+'/audio-compare',{snapshot:item.snapshot,mode:'tracks'});if(!current())return;observePreparation(data.preparation);
  for(const [select,tracks,key]of [[a,data.original,'originalIndex'],[b,data.review,'reviewIndex']]){select.append(new Option(tr('Vyber zvukovou stopu'),''));for(const track of tracks){const option=el('option','',audioTrackLabel(track.label),true);option.value=String(track.index);select.append(option)}select.value=options.scope?.[key]===null||options.scope?.[key]===undefined?'':String(options.scope[key])}
  trackReady=a.value!==''&&b.value!=='';lastScope=previewIdentity();const ready=()=>{trackReady=a.value!==''&&b.value!=='';setWorking(false)};a.addEventListener('change',ready);b.addEventListener('change',ready);setWorking(false);status.textContent=tr('Vyber odpovídající stopy a připrav ukázku.');startAutomatic();
 }catch(e){if(current())status.textContent=tr(e.message)}})();
 return cleanup;
}

class AudioABPlayer {
 constructor(context){this.context=context;this.sources=[];this.gain=context.createGain();this.gain.gain.value=.5;this.gain.connect(context.destination);}
 stop(){for(const s of this.sources){s.onended=null;try{s.stop()}catch{}}this.sources=[];}
 buffer(packet,channel){const raw=atob(packet.pcm),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);if(bytes.length!==packet.frames*4||packet.sampleRate!==48000)throw Error('Neplatný poslechový úsek.');const view=new DataView(bytes.buffer),b=this.context.createBuffer(2,packet.frames,packet.sampleRate),data=b.getChannelData(channel);for(let i=0;i<data.length;i++){const v=view.getFloat32(i*4,true);if(!Number.isFinite(v))throw Error('Neplatný zvukový vzorek.');data[i]=v;}return b;}
 play(original,review,ended){this.stop();const a=this.buffer(original,0),b=this.buffer(review,1),start=this.context.currentTime+.05;for(const [buffer,when] of [[a,start],[b,start+a.duration+.3]]){const s=this.context.createBufferSource();s.buffer=buffer;s.connect(this.gain);this.sources.push(s);s.start(when);}this.sources[1].onended=()=>{this.sources=[];ended?.()};return {originalSeconds:a.duration,reviewSeconds:b.duration};}
 close(){this.stop();void this.context.close();}
}
