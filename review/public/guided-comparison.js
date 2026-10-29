import {createGuidedPlayer} from './guided-player.js?v=__APP_VERSION__';
import {mountPlayerControls} from './player-controls.js?v=__APP_VERSION__';
import {guidedExcerptTimes,prepareGuidedExcerpts} from './guided-preparation.js?v=__APP_VERSION__';
import {translateAudioTrackLabel} from './i18n.js?v=__APP_VERSION__';

const modeName=routing=>routing==='ears'?'guided-ears':routing==='switch'?'guided-switch':'guided-sequential';
/** A bounded preview workspace. Playback never invokes a review-session write. With stage the media fills the
 * host, plays one excerpt at a time and the caller drives it through the returned cleanup's controller. */
export function mountGuidedComparison(host,item,{api,current=()=>true,scope={},excerptTimes,comparison,canInteract=()=>true,beforePreview,stage=false,
 onScopeChange=()=>{},onTimesChange=()=>{},onRoutingChange=()=>{},onScopeValidityChange=()=>{},onPlaybackState=()=>{},onPreparation=()=>{},onExternalReview,onFrames,onExitPlayer=()=>{},tr=x=>x}={}){
 const doc=host.ownerDocument||document,make=(tag,label)=>{const node=doc.createElement(tag);if(label!==undefined)node.textContent=tr(label);return node};
 const root=make('section');root.className='guided-comparison';root.tabIndex=0;root.setAttribute('role','region');root.setAttribute('aria-label',tr('Řízené porovnání tří ukázek'));
 const fields=make('details'),summary=make('summary','Stopy, časy a další možnosti');fields.append(summary);
 const selectors=[make('select'),make('select')],times=[],scopeInputs=make('div');scopeInputs.className='comparison-controls';
 const status=make('p','Vyber odpovídající stopy a spusť porovnání.');status.setAttribute('role','status');
 const preparation=make('ol'),pair=make('div'),lanes=make('div'),media=make('div'),limits=make('details'),limitSummary=make('summary','Meze náhledu');
 pair.className='av-pair av-wipe guided-pair';media.className='guided-media';lanes.className='guided-lanes';lanes.setAttribute('aria-label',tr('Časové osy levého a pravého ucha'));
 limits.append(limitSummary,make('p','Ztrátový SDR náhled a mono zvuk nedokládají původní rozlišení, prostorový mix ani HDR. Přehrání nikdy nepotvrzuje posouzení.'));
 let dead=false,epoch=0,player=null,context=null,clips=null,preparing=null,raf=0,activeVideo=-1,view='wipe',geometry='fit',wipe=50;
 let routing=comparison?.mode==='guided-sequential'?'sequential':comparison?.mode==='guided-switch'?'switch':'ears',swapEars=!!comparison?.swapEars,volume=.5,muted=false,focus=false,listen='original',wipeMode='half';
 const observers=new Set(),urls=[],videos=[],videoListeners=[];let announced='';
 const divider=make('div','↔');divider.className='av-divider';divider.tabIndex=0;divider.setAttribute('role','slider');divider.setAttribute('aria-label',tr('Dělicí čára obrazu'));divider.setAttribute('aria-valuemin','0');divider.setAttribute('aria-valuemax','100');
 let base={status:'idle',excerptIndex:0,excerptCount:3,phaseIndex:0,phase:routing==='switch'?'switch':'original',position:0,duration:12,totalDuration:108,elapsed:0,sourceTime:0,volume,muted,routing,swapEars,listen};
 const valid=()=>!dead&&current()&&root.isConnected;
 const snapshot=()=>player?.snapshot()||{...base};
 function broadcast(){if(!valid())return;const value=snapshot();for(const listener of observers)listener(value);const key=JSON.stringify([value.status,value.excerptIndex,value.phase,value.listen,!!clips]);if(key!==announced){announced=key;onPlaybackState({...value,videoAvailable:!!clips})}renderLanes(value)}
 function errorText(error){const message=error?.message||String(error);status.textContent=tr({'Invalid audio excerpt.':'Neplatný poslechový úsek.','Invalid audio routing.':'Neplatný režim porovnání.','Invalid seek position.':'Neplatný čas porovnání.','Three audio excerpts are required.':'Vyber tři platné úseky porovnání.','Invalid audio sample rate.':'Neplatná vzorkovací frekvence zvuku.','Volume must be between 0 and 1.':'Hlasitost musí být mezi 0 a 1.','Unknown audio command.':'Neplatný příkaz přehrávače.','Invalid excerpt.':'Neplatný úsek řízeného porovnání.'}[message]||message);}
 function stopVideo(){for(const video of videos)video.pause();cancelAnimationFrame(raf);raf=0;}
 function releaseVideo(){stopVideo();for(const [node,event,fn] of videoListeners)node.removeEventListener(event,fn);videoListeners.length=0;for(const video of videos){video.removeAttribute('src');video.load()}videos.length=0;for(const url of urls)URL.revokeObjectURL(url);urls.length=0;activeVideo=-1;pair.replaceChildren()}
 function invalidate(){epoch++;preparing=null;player?.destroy();player=null;clips=null;releaseVideo();base={...base,status:'idle',position:0,elapsed:0,routing,swapEars};broadcast()}
 let chosen;
 try{chosen=guidedExcerptTimes(Math.min(item.durationA,item.durationB),excerptTimes)}catch(error){chosen=[0,0,0];base.status='disabled';onScopeValidityChange(false);errorText(error)}
 function selectedScope(){return {originalIndex:selectors[0].value===''?null:Number(selectors[0].value),reviewIndex:selectors[1].value===''?null:Number(selectors[1].value),seconds:chosen[0]}}
 function fieldsChanged(){
  if(!canInteract())return;
  const values=times.map(input=>Number(input.value)),correct=times.every(input=>input.value!==''&&input.validity.valid);
  try{if(!correct)throw Error('Neplatný úsek řízeného porovnání.');chosen=guidedExcerptTimes(Math.min(item.durationA,item.durationB),values);onScopeValidityChange(true)}catch(error){invalidate();base.status='disabled';onScopeValidityChange(false);errorText(error);broadcast();return}
  invalidate();onScopeChange(selectedScope());onTimesChange([...chosen]);onRoutingChange({mode:modeName(routing),swapEars,excerpts:[...chosen]});
 }
 for(const [i,label] of ['Stopa originálu','Stopa převodu'].entries()){const container=make('label',label);container.append(selectors[i]);scopeInputs.append(container);selectors[i].addEventListener('change',fieldsChanged)}
 for(const [i,label] of ['Začátek filmu','Střed filmu','Konec filmu'].entries()){
  const container=make('label',label),input=make('input');input.type='number';input.min='0';input.max=String(Math.max(0,Math.min(item.durationA,item.durationB)-12));input.step='.001';input.value=String(chosen[i]);input.setAttribute('aria-label',tr(label)+' · '+tr('Čas ve filmu (sekundy)'));input.addEventListener('change',fieldsChanged);times.push(input);container.append(input);scopeInputs.append(container);
 }
 const fitLabel=make('label','Geometrie obrazu'),fit=make('select');for(const [value,label]of [['fit','Přizpůsobit bez změny poměru'],['stretch','Roztáhnout'],['fill','Vyplnit s ořezem']]){const option=make('option',label);option.value=value;fit.append(option)}
 try{const saved=localStorage.getItem('tdarr-review-comparison-geometry');if(['fit','stretch','fill'].includes(saved))geometry=saved}catch{}
 fit.value=geometry;fitLabel.append(fit);scopeInputs.append(fitLabel);fields.append(scopeInputs);
 const geometryBadge=make('details'),geometrySummary=make('summary');geometryBadge.className='guided-geometry-badge';geometryBadge.append(geometrySummary,make('p','Změněná geometrie je shodná pro oba obrazy. Zvětšený náhled není důkaz původního rozlišení.'));
 function setGeometry(){geometry=fit.value;root.dataset.geometry=geometry;geometrySummary.textContent=tr(geometry==='fit'?'Náhled přizpůsobený bez protažení':geometry==='stretch'?'Obraz je protažený':'Obraz je oříznutý');try{localStorage.setItem('tdarr-review-comparison-geometry',geometry)}catch{}}
 fit.addEventListener('change',setGeometry);setGeometry();
 const routeNote=make('p');routeNote.className='details';
 function describeRouting(){routeNote.textContent=tr(routing==='switch'?'Přepínání: oba zvuky běží současně, slyšíš jeden. Klávesa A přepne originál a převod bez přerušení. Každý úsek zazní jednou.':routing==='sequential'?'Obě uši: stejný úsek dvakrát — originál, potom převod. Tři ukázky: nejvýše 72 sekund zvuku plus viditelné přechody.':swapEars?'Sluchátka: stejný úsek třikrát — originál vpravo, oba současně, převod vlevo. Tři ukázky: nejvýše 108 sekund zvuku plus viditelné přechody.':'Sluchátka: stejný úsek třikrát — originál vlevo, oba současně, převod vpravo. Tři ukázky: nejvýše 108 sekund zvuku plus viditelné přechody. Spusť pouze s odpovídajícími stopami.')}
 describeRouting();
 const cursor=make('progress');cursor.max=12;cursor.value=0;cursor.setAttribute('aria-label',tr('Průběh stejného filmového úseku'));
 const canvases=[];const laneLabels=['Levé ucho','Pravé ucho'].map(label=>{const row=make('p',label),canvas=make('canvas');canvas.width=600;canvas.height=44;canvas.setAttribute('aria-label',tr(label)+' · '+tr('Zvukový průběh'));canvas.className='guided-waveform';canvases.push(canvas);lanes.append(row,canvas);return row});lanes.append(cursor);
 const waves=make('canvas');waves.className='guided-waves';waves.width=1200;waves.height=60;waves.setAttribute('aria-label',tr('Zvukový průběh originálu (nahoře) a převodu (dole)'));
 const progress=make('progress');progress.className='guided-stage-progress';progress.max=3;progress.value=0;progress.hidden=true;progress.setAttribute('aria-label',tr('Příprava ukázek'));
 function peaksOf(excerpt,key,data,width){excerpt.peaks??={};const name=key+width;if(!excerpt.peaks[name]){const peaks=new Float32Array(width);for(let x=0;x<width;x++)for(let j=Math.floor(x*data.length/width);j<Math.floor((x+1)*data.length/width);j++)peaks[x]=Math.max(peaks[x],Math.abs(data[j]));excerpt.peaks[name]=peaks}return excerpt.peaks[name]}
 function renderWaves(value){
  const drawing=waves.getContext?.('2d');if(!drawing)return;const {width,height}=waves,middle=height/2,excerpt=clips?.[value.excerptIndex];drawing.clearRect(0,0,width,height);
  if(excerpt)for(const [key,data,direction,color]of [['original',excerpt.original,-1,value.listen==='original'?'#9be7d4':'#6a9e92'],['review',excerpt.review,1,value.listen==='transcode'?'#ffd7a0':'#a88d68']]){const peaks=peaksOf(excerpt,key,data,width);drawing.fillStyle=color;for(let x=0;x<width;x++){const size=Math.max(1,Math.min(1,peaks[x])*(middle-2));drawing.fillRect(x,direction<0?middle-size:middle,1,size)}}
  drawing.fillStyle='#ffffff';drawing.fillRect((value.position/(value.duration||1))*width,0,2,height);
 }
 waves.addEventListener('pointerdown',event=>{const box=waves.getBoundingClientRect?.();const state=snapshot();if(!box?.width||!clips)return;event.preventDefault?.();void facade.command('seek',Math.max(0,Math.min(1,(event.clientX-box.left)/box.width))*(state.duration||0))});
 function renderLanes(value){
  if(stage){renderWaves(value);return}
  const channelNames=value.routing==='sequential'?[value.phase==='transcode'?'Převod':'Originál',value.phase==='transcode'?'Převod':'Originál']:[value.phase==='transcode'?'Ticho':'Originál',value.phase==='original'?'Ticho':'Převod'];
  if(value.routing==='ears'&&value.swapEars)channelNames.reverse();
  laneLabels.forEach((row,i)=>row.textContent=tr(i?'Pravé ucho':'Levé ucho')+' · '+tr(channelNames[i])+' · '+Number(value.sourceTime||0).toFixed(2)+' s');cursor.max=value.duration||12;cursor.value=value.position||0;
  const excerpt=clips?.[value.excerptIndex];for(const [i,canvas]of canvases.entries()){const drawing=canvas.getContext?.('2d');if(!drawing)continue;drawing.clearRect(0,0,canvas.width,canvas.height);drawing.fillStyle='#65d5bb';const data=channelNames[i]==='Originál'?excerpt?.original:channelNames[i]==='Převod'?excerpt?.review:null;
   if(data){excerpt.peaks??={};const key=channelNames[i];if(!excerpt.peaks[key]){const peaks=new Float32Array(600);for(let x=0;x<600;x++)for(let j=Math.floor(x*data.length/600);j<Math.floor((x+1)*data.length/600);j++)peaks[x]=Math.max(peaks[x],Math.abs(data[j]));excerpt.peaks[key]=peaks}for(let x=0;x<600;x++){const height=Math.min(1,excerpt.peaks[key][x])*40;drawing.fillRect(x,22-height/2,1,Math.max(1,height))}}
   drawing.fillStyle='#ffd07d';drawing.fillRect((value.position/(value.duration||1))*600,0,2,44);
  }
 }
 async function preparePhase({excerptIndex,position},autoplay=true){
  cancelAnimationFrame(raf);raf=0;
  if(!valid()||!clips)throw Error('Rozsah porovnání se změnil. Připrav ukázky znovu.');
  if(activeVideo!==excerptIndex){releaseVideo();activeVideo=excerptIndex;
   for(const [key,label]of [['original','Originál'],['review','Převod']]){
    const figure=make('figure'),video=make('video');figure.className='av-pane '+(key==='original'?'av-original-pane':'av-review-pane');video.muted=true;video.volume=0;video.playsInline=true;video.preload='auto';video.setAttribute('aria-label',tr(label));
    const bytes=Uint8Array.from(atob(clips[excerptIndex].video[key]),x=>x.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));urls.push(url);video.src=url;videos.push(video);figure.append(make('figcaption',label),video);pair.append(figure);
    const interrupted=()=>{if(player?.snapshot().status==='playing'){void player.command('pause');stopVideo();status.textContent=tr('Video čeká nebo selhalo. Porovnání je pozastavené; pokračuj až po načtení.')}};
    for(const event of ['waiting','error']){video.addEventListener(event,interrupted);videoListeners.push([video,event,interrupted])}
    const aspect=()=>{const first=videos[0];if(first?.videoWidth>0&&first.videoHeight>0)pair.style.setProperty('--av-aspect',String(first.videoWidth/first.videoHeight))};video.addEventListener('loadedmetadata',aspect);videoListeners.push([video,'loadedmetadata',aspect]);
   }
   pair.append(divider);setView(view);
  }
  for(const video of videos){video.pause();video.currentTime=position}
  if(autoplay)await Promise.all(videos.map(video=>video.play()));
  if(!valid())throw Error('Rozsah porovnání se změnil. Připrav ukázky znovu.');
 }
 function tick(){
  if(!valid()){void player?.command('pause');stopVideo();return}
  const state=snapshot();if(state.status!=='playing'){stopVideo();broadcast();return}
  // Audio keeps the real source offsets. Only the visual cursor follows its
  // clock; a large video discontinuity pauses rather than hiding the fault.
  if(videos.some(video=>video.readyState<3||Math.abs(video.currentTime-state.position)>.2)){
   void player.command('pause');stopVideo();status.textContent=tr('Video a zvuk se rozešly. Porovnání je pozastavené; zkus úsek znovu.');broadcast();return;
  }
  if(wipeMode==='auto'){wipe=50+40*Math.sin(state.position*Math.PI/3);setView('wipe')}
  broadcast();raf=requestAnimationFrame(tick);
 }
 async function ready(){
  if(preparing)return preparing;if(clips)return;
  const ticket=epoch;const captured=selectedScope();
  if(!Number.isInteger(captured.originalIndex)||!Number.isInteger(captured.reviewIndex))throw Error('Vyber odpovídající zvukové stopy.');
  base.status='preparing';broadcast();
  preparing=(async()=>{
   await beforePreview?.();if(!valid()||ticket!==epoch)return;
   const result=await prepareGuidedExcerpts({times:chosen,scope:captured,snapshot:item.snapshot,current:()=>valid()&&ticket===epoch,
    load:body=>api('/api/items/'+item.id+'/audio-compare',body),onState:rows=>{const ready=rows.filter(row=>row.status==='ready').length;progress.value=ready;progress.hidden=ready===rows.length||rows.some(row=>row.status==='error');preparation.hidden=stage||rows.every(row=>row.status==='ready');preparation.replaceChildren(...rows.map((row,i)=>make('li',tr('Ukázka')+' '+(i+1)+' · '+row.seconds.toFixed(2)+' s · '+tr({waiting:'Čeká',preparing:'Připravuje se',ready:'Připraveno',error:'Chyba'}[row.status]))));onPreparation({guided:rows})}});
   if(!valid()||ticket!==epoch)return;clips=result;
   player=createGuidedPlayer({context,excerpts:clips,preparePhase,perExcerpt:stage,onState:value=>{
    if(value.status==='playing'){status.textContent=stage?'':tr('Řízené porovnání běží. Potvrzení posouzení zůstávají ruční.');cancelAnimationFrame(raf);raf=requestAnimationFrame(tick)}else{stopVideo();if(value.status==='suspended')status.textContent=tr('Prohlížeč pozastavil zvuk. Pokračuj tlačítkem Přehrát.');if(clips&&['paused','idle'].includes(value.status))void preparePhase(value,false).catch(errorText);if(value.error)errorText(value.error)}broadcast();
   }});
   await player.command('volume',volume);await player.command('mute',muted);await player.command('routing',{mode:routing,swapEars});await player.command('listen',listen);broadcast();
  })().finally(()=>{if(ticket===epoch)preparing=null});return preparing;
 }
 const facade={snapshot,subscribe(listener){observers.add(listener);return()=>observers.delete(listener)},async command(action,value){
  if(!valid()||!canInteract())return;
  try{
   if(action==='routing'){routing=value.mode;swapEars=!!value.swapEars;describeRouting();onRoutingChange({mode:modeName(routing),swapEars,excerpts:[...chosen]});base={...base,routing,swapEars};}
   if(action==='volume'){volume=value;base.volume=value}if(action==='mute'){muted=typeof value==='boolean'?value:!muted;base.muted=muted}
   if(action==='listen'){listen=value??(listen==='original'?'transcode':'original');base.listen=listen;if(wipeMode==='off')applyWipeMode()}
   if(action==='excerpt'&&!player){base={...base,excerptIndex:Math.max(0,Math.min(2,Number(value?.index)||0)),position:0}}
   if(!player&&(['play','toggle'].includes(action)||action==='excerpt'&&value?.play)){
    const AudioCtor=globalThis.AudioContext||globalThis.webkitAudioContext;if(!AudioCtor)throw Error('Prohlížeč nepodporuje zvukové A/B.');
    context??=new AudioCtor();await context.resume();await ready();
   }
   if(player)await player.command(action,action==='listen'?listen:value);else broadcast();
  }catch(error){if(valid()){base.status='error';errorText(error);broadcast()}}
 }};
 const viewLabel=make('p');viewLabel.className='guided-view-label';
 function setView(next){view=next;pair.classList.toggle('av-wipe',view==='wipe');pair.classList.toggle('av-side',view==='side');pair.style.setProperty('--av-wipe',wipe+'%');divider.hidden=view!=='wipe'||!videos.length||wipeMode==='off';divider.setAttribute('aria-valuenow',String(wipe));viewLabel.textContent=tr(view==='wipe'?'Dělicí čára':'Vedle sebe');}
 // The stage divider: 50 %, a slow automatic sweep, or off (only the copy being heard is shown).
 function applyWipeMode(){wipe=wipeMode==='off'?(listen==='original'?100:0):50;wipeInput.value=String(wipe);root.dataset.wipe=wipeMode;setView('wipe')}
 function setWipeMode(next){wipeMode=['half','auto','off'].includes(next)?next:'half';applyWipeMode();return wipeMode}
 const wipeInput=make('input');wipeInput.type='range';wipeInput.min='0';wipeInput.max='100';wipeInput.value='50';wipeInput.setAttribute('aria-label',tr('Pozice dělicí čáry'));wipeInput.oninput=()=>{wipe=Number(wipeInput.value);setView('wipe')};fields.append(wipeInput);
 if(onFrames){const frames=make('button','Statické snímky v původním rozlišení · 1 : 1');frames.type='button';frames.onclick=()=>{void facade.command('pause');onFrames(selectedScope())};fields.append(frames)}
 const frameNote=make('p','Krokování je přibližné: 1/24 sekundy. U proměnlivé snímkové frekvence nejde o přesný snímek.');fields.append(frameNote);
 for(const [label,delta]of [['Předchozí přibližný snímek',-1/24],['Další přibližný snímek',1/24]]){const step=make('button',label);step.type='button';step.onclick=async()=>{await facade.command('pause');await facade.command('seek',Math.max(0,snapshot().position+delta))};fields.append(step)}
 const retry=make('button','Připravit porovnání znovu');retry.type='button';retry.onclick=()=>{invalidate();void facade.command('play')};fields.append(retry);
 if(onExternalReview){const external=make('button','Posoudit ve vlastním přehrávači');external.type='button';external.onclick=()=>{invalidate();onExternalReview()};fields.append(external)}
 if(stage){
  // Stage: the image fills the host; options stay in a hidden panel the caller opens.
  const modeLabel=make('label','Zvuk'),mode=make('select');for(const [value,label]of [['switch','Přepínání originál ↔ převod (A)'],['ears','Sluchátka: levé a pravé ucho'],['sequential','Po sobě: originál, potom převod']]){const option=make('option',label);option.value=value;mode.append(option)}mode.value=routing;mode.addEventListener('change',()=>void facade.command('routing',{mode:mode.value,swapEars}));modeLabel.append(mode);scopeInputs.append(modeLabel);
  root.classList.add('guided-stage');fields.className='guided-stage-options';fields.hidden=true;status.className='guided-stage-status';status.textContent='';
  root.append(media,waves,progress,status,fields);media.append(pair);host.replaceChildren(root);
 }else{root.append(routeNote,fields,status,preparation,geometryBadge,viewLabel,media,lanes,limits);media.append(pair);host.replaceChildren(root);}
 const cleanupControls=stage?()=>{}:mountPlayerControls(root,facade,{tr,onView:()=>setView(view==='wipe'?'side':'wipe'),onWipe:()=>setView('wipe'),
  onFullscreen:()=>{if(doc.fullscreenElement===root)void doc.exitFullscreen?.();else void root.requestFullscreen?.().catch(errorText)},
  onFocus:()=>{focus=!focus;root.classList.toggle('guided-focus',focus)},onEscape:({editable=false}={})=>{if(doc.fullscreenElement===root)void doc.exitFullscreen?.();else if(focus){focus=false;root.classList.remove('guided-focus')}else if(editable)return false;else{void facade.command('pause');onExitPlayer()}return true}});
 setView('wipe');broadcast();
 let dragging=false;const moveWipe=event=>{const box=pair.getBoundingClientRect();if(box.width){wipe=Math.max(0,Math.min(100,(event.clientX-box.left)/box.width*100));wipeInput.value=String(wipe);setView('wipe')}};
 divider.onpointerdown=event=>{if(event.button!==undefined&&event.button!==0)return;event.preventDefault();dragging=true;divider.focus();divider.setPointerCapture?.(event.pointerId);moveWipe(event)};divider.onpointermove=event=>{if(dragging)moveWipe(event)};divider.onpointerup=divider.onpointercancel=()=>{dragging=false};divider.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();wipe=event.key==='Home'?0:event.key==='End'?100:Math.max(0,Math.min(100,wipe+(event.key==='ArrowLeft'?-1:1)));wipeInput.value=String(wipe);setView('wipe')};
 const focusPlayer=event=>{if(!event.target.closest?.('button,input,select,textarea,summary,a,[role="slider"]'))root.focus({preventScroll:true})};root.addEventListener('pointerdown',focusPlayer);
 void api('/api/items/'+item.id+'/audio-compare',{snapshot:item.snapshot,mode:'tracks'}).then(data=>{
  if(!valid())return;for(const [i,list,key]of [[0,data.original,'originalIndex'],[1,data.review,'reviewIndex']]){const empty=make('option','Vyber zvukovou stopu');empty.value='';selectors[i].append(empty);for(const track of list||[]){const option=make('option');option.textContent=translateAudioTrackLabel(track.label,tr);option.value=String(track.index);selectors[i].append(option)}selectors[i].value=scope[key]===null||scope[key]===undefined?'':String(scope[key])}
 }).catch(error=>{if(valid())errorText(error)});
 const cleanup=()=>{if(dead)return;dead=true;epoch++;root.removeEventListener('pointerdown',focusPlayer);player?.destroy();cleanupControls();releaseVideo();void context?.close();observers.clear();host.replaceChildren()};
 cleanup.controller={...facade,setWipeMode,get wipeMode(){return wipeMode},options(open){fields.hidden=!open;fields.open=!!open;if(open)(selectors[0]||fields).focus?.()},get optionsOpen(){return !fields.hidden},pairLabels:()=>selectors.map(select=>select.selectedIndex>0?select.options?.[select.selectedIndex]?.textContent||'':'')};
 return cleanup;
}
