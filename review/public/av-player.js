export function mountAVComparison(host,data,{tr=x=>x}={}){
 const make=(tag,text)=>{const x=document.createElement(tag);if(text)x.textContent=tr(text);return x};
 const urls=[],videos=[],listeners=[],pair=make('div');pair.className='av-pair av-wipe';
 let dead=false,raf=0,playing=false,pendingPlay=false,playGeneration=0,sound=0,lastSync=0,mode='wipe',wipe=50,dragPointer=null,sweepEnabled=false,sweepElapsed=0,sweepLast=null,sweepInitial=false;
 const listen=(node,event,fn)=>{node.addEventListener(event,fn);listeners.push([node,event,fn])};
 const status=make('p');status.setAttribute('role','status');
 const sourceLabels=make('div');sourceLabels.className='av-source-labels';
 for(const [i,name]of ['Originál','Převod'].entries()){
  const figure=make('figure'),v=make('video'),label=make('span',name);figure.className='av-pane '+(i?'av-review-pane':'av-original-pane');label.className=i?'av-review-label':'av-original-label';sourceLabels.append(label);
  v.playsInline=true;v.preload='auto';v.muted=i!==sound;v.volume=.5;v.controls=false;v.setAttribute('aria-label',tr(name));
  const bytes=Uint8Array.from(atob(i?data.review:data.original),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));urls.push(url);v.src=url;videos.push(v);figure.append(make('figcaption',name),v);pair.append(figure);
 }
 const layoutControls=make('div');layoutControls.className='av-layout-controls';
 const layoutLabel=make('label','Zobrazení porovnání'),layout=make('select');layout.setAttribute('aria-label',tr('Zobrazení porovnání'));
 for(const [value,label]of [['wipe','Dělicí čára'],['side','Vedle sebe']]){const option=make('option',label);option.value=value;layout.append(option)}layout.value='wipe';layoutLabel.append(layout);layoutControls.append(layoutLabel);
 const wipeControls=make('div');wipeControls.className='av-wipe-controls';
 const positionLabel=make('label','Pozice dělicí čáry'),position=make('input'),positionOutput=make('output');position.type='range';position.min='0';position.max='100';position.step='1';position.value='50';position.className='av-wipe-position';position.setAttribute('aria-label',tr('Pozice dělicí čáry'));positionOutput.className='av-wipe-value';positionLabel.append(position,positionOutput);
 const autoLabel=make('label'),auto=make('input');auto.type='checkbox';auto.checked=false;auto.setAttribute('aria-label',tr('Automatický pohyb dělicí čáry'));autoLabel.className='av-auto-sweep';autoLabel.append(auto,make('span','Automatický pohyb dělicí čáry'));wipeControls.append(positionLabel,autoLabel);
 const divider=make('div'),grip=make('span','↔');divider.className='av-divider';grip.className='av-divider-grip';grip.setAttribute('aria-hidden','true');divider.tabIndex=0;divider.setAttribute('role','slider');divider.setAttribute('aria-label',tr('Dělicí čára obrazu'));divider.setAttribute('aria-valuemin','0');divider.setAttribute('aria-valuemax','100');divider.setAttribute('aria-orientation','horizontal');divider.append(grip);pair.append(divider);
 const aspectWarning=make('p');aspectWarning.className='av-aspect-warning';aspectWarning.setAttribute('role','status');aspectWarning.hidden=true;
 function setWipe(value){
  wipe=Math.max(0,Math.min(100,Number(value)));if(!Number.isFinite(wipe))wipe=50;
  pair.style.setProperty('--av-wipe',wipe+'%');pair.style.setProperty('--av-grip-shift',wipe<3?'0%':wipe>97?'-100%':'-50%');
  position.value=String(Math.round(wipe));positionOutput.value=Math.round(wipe)+' %';divider.setAttribute('aria-valuenow',String(Math.round(wipe)));divider.setAttribute('aria-valuetext',tr('Originál vlevo, převod vpravo')+' · '+Math.round(wipe)+' %');
 }
 function stopSweep(){sweepEnabled=false;auto.checked=false;sweepLast=null;sweepInitial=false}
 function endDrag(){const pointer=dragPointer;dragPointer=null;divider.classList.remove('dragging');if(pointer!==null&&divider.hasPointerCapture?.(pointer))divider.releasePointerCapture(pointer)}
 const dragAt=e=>{const rect=pair.getBoundingClientRect();if(rect.width>0)setWipe((e.clientX-rect.left)/rect.width*100)};
 listen(divider,'pointerdown',e=>{if(dead||mode!=='wipe'||dragPointer!==null||e.button!==undefined&&e.button!==0)return;e.preventDefault();stopSweep();dragPointer=e.pointerId;divider.classList.add('dragging');divider.focus({preventScroll:true});divider.setPointerCapture(e.pointerId);dragAt(e)});
 listen(divider,'pointermove',e=>{if(e.pointerId!==dragPointer)return;e.preventDefault();dragAt(e)});
 listen(divider,'pointerup',e=>{if(e.pointerId===dragPointer)endDrag()});listen(divider,'pointercancel',e=>{if(e.pointerId===dragPointer)endDrag()});listen(divider,'lostpointercapture',e=>{if(e.pointerId===dragPointer)endDrag()});
 listen(divider,'keydown',e=>{const changes={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1,PageDown:-10,PageUp:10};if(!(e.key in changes)&&!['Home','End'].includes(e.key))return;e.preventDefault();stopSweep();setWipe(e.key==='Home'?0:e.key==='End'?100:wipe+changes[e.key])});
 listen(position,'input',()=>{stopSweep();setWipe(Number(position.value))});
 listen(position,'pointerdown',stopSweep);listen(position,'keydown',e=>{if(['ArrowLeft','ArrowDown','ArrowRight','ArrowUp','PageDown','PageUp','Home','End'].includes(e.key))stopSweep()});
 listen(auto,'change',()=>{sweepEnabled=auto.checked;sweepElapsed=0;sweepLast=null;sweepInitial=sweepEnabled});
 listen(layout,'change',()=>{endDrag();mode=layout.value==='side'?'side':'wipe';pair.classList.toggle('av-wipe',mode==='wipe');pair.classList.toggle('av-side',mode==='side');wipeControls.hidden=mode!=='wipe';divider.hidden=mode!=='wipe';sweepLast=null});
 function updateAspect(){
  const ratios=videos.map(v=>v.videoWidth>0&&v.videoHeight>0?v.videoWidth/v.videoHeight:null);if(ratios[0])pair.style.setProperty('--av-aspect',String(ratios[0]));
  if(!ratios.every(x=>x!==null))return;const mismatch=Math.abs(ratios[0]-ratios[1])/Math.max(...ratios)>.01;aspectWarning.hidden=!mismatch;
  aspectWarning.textContent=mismatch?tr('Poměr stran náhledů se liší. Oba obrazy jsou zobrazené bez ořezu a bez protažení; odpovídající detaily nemusí ležet na stejném místě. Použij také zobrazení Vedle sebe.'):'';
 }
 function sweepTick(now){
  if(!sweepEnabled||mode!=='wipe'||dragPointer!==null||videos.some(v=>v.paused||v.ended||v.readyState<3)){sweepLast=null;return}
  if(sweepInitial){sweepInitial=false;sweepElapsed=0;setWipe(25)}
  if(sweepLast!==null)sweepElapsed+=Math.max(0,now-sweepLast)/1000;sweepLast=now;
  const phase=(sweepElapsed*12.5)%100;setWipe(25+(phase<=50?phase:100-phase));
 }
 const controls=make('div');controls.className='comparison-controls';const play=make('button','Přehrát / pozastavit'),back=make('button','Předchozí snímek'),next=make('button','Další snímek'),audio=make('select'),volume=make('input');
 for(const [i,name]of ['Zvuk originálu','Zvuk převodu','Bez zvuku'].entries()){const o=make('option',name);o.value=String(i);audio.append(o)}audio.setAttribute('aria-label',tr('Přehrávaný zvuk'));
 volume.type='range';volume.min='0';volume.max='1';volume.step='.05';volume.value='.5';volume.setAttribute('aria-label',tr('Společná hlasitost'));
 for(const b of [play,back,next])b.type='button';controls.append(play,back,next,audio,volume);
 const seek=make('input');seek.type='range';seek.min='0';seek.max=String(data.duration);seek.step='.01';seek.value='0';seek.setAttribute('aria-label',tr('Společná časová osa'));seek.className='av-seek';const time=make('output');
 const canvas=make('canvas');canvas.width=1100;canvas.height=220;canvas.style.width='100%';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',tr('Zvukové průběhy originálu a převodu na společné časové ose'));
 const draw=()=>{const c=canvas.getContext('2d'),max=Math.max(.001,...data.originalWave,...data.reviewWave);c.fillStyle='#111827';c.fillRect(0,0,1100,220);
  for(const [wave,title,color,base]of [[data.originalWave,'Originál','#38bdf8',90],[data.reviewWave,'Převod','#fbbf24',175]]){c.fillStyle=color;c.font='14px sans-serif';c.fillText(tr(title),12,base-50);c.strokeStyle=color;c.beginPath();wave.forEach((v,i)=>{const x=85+i/(data.duration*100)*990,y=base-v/max*45;i?c.lineTo(x,y):c.moveTo(x,y)});c.stroke()}
  const x=85+Number(seek.value)/data.duration*990;c.strokeStyle='#fff';c.beginPath();c.moveTo(x,20);c.lineTo(x,190);c.stroke();c.fillStyle='#ddd';for(let i=0;i<=data.duration;i+=2)c.fillText((data.seconds+i).toFixed(1)+' s',85+i/data.duration*990-20,210);
  time.value=(data.seconds+Number(seek.value)).toFixed(2)+' s';
 };
 const pause=()=>{playing=false;pendingPlay=false;playGeneration++;sweepLast=null;videos.forEach(v=>v.pause());cancelAnimationFrame(raf);raf=0};
 const duration=()=>Math.min(data.duration,...videos.map(v=>Number.isFinite(v.duration)?v.duration:data.duration));
 const move=value=>{pause();const t=Math.max(0,Math.min(duration(),value));videos.forEach(v=>v.currentTime=t);seek.value=String(t);draw()};
 const tick=stamp=>{if(dead||!playing)return;const now=Number.isFinite(stamp)?stamp:performance.now();if(videos.some(v=>v.paused||v.ended)){pause();return}seek.value=String(videos[0].currentTime);const drift=videos[1].currentTime-videos[0].currentTime;
  if(Math.abs(drift)>.08&&now-lastSync>500&&!videos[1].seeking){videos[1].currentTime=videos[0].currentTime;lastSync=now;status.textContent=tr('Přehrávače byly znovu synchronizovány. Při posuzování drobného posunu použij krokování.')}
  sweepTick(now);draw();if(videos[0].currentTime>=duration()-.03)pause();else raf=requestAnimationFrame(tick);
 };
 listen(play,'click',async()=>{if(playing||pendingPlay){pause();return}if(videos[0].currentTime>=duration()-.05)move(0);const attempt=++playGeneration;pendingPlay=true;
  try{await Promise.all(videos.map(v=>v.play()));if(dead||attempt!==playGeneration){if(dead||!playing&&!pendingPlay)videos.forEach(v=>v.pause());return}pendingPlay=false;playing=true;status.textContent=tr('Přehrávání společného úseku.');tick()}
  catch{if(!dead&&attempt===playGeneration){pause();status.textContent=tr('Náhled nelze přehrát v tomto prohlížeči.')}}
 });
 const rate=data.frameRates?.[0],step=rate&&rate<=120?1/rate:1/24;listen(back,'click',()=>move(videos[0].currentTime-step));listen(next,'click',()=>move(videos[0].currentTime+step));
 listen(seek,'input',()=>move(Number(seek.value)));listen(canvas,'click',e=>{const rect=canvas.getBoundingClientRect();move(((e.clientX-rect.left)/rect.width*1100-85)/990*data.duration)});
 listen(audio,'change',()=>{sound=Number(audio.value);videos.forEach((v,i)=>v.muted=i!==sound)});listen(volume,'input',()=>videos.forEach(v=>v.volume=Number(volume.value)));
 for(const v of videos){listen(v,'loadedmetadata',updateAspect);listen(v,'resize',updateAspect);listen(v,'ended',pause);listen(v,'pause',()=>{if(playing)pause()});listen(v,'waiting',()=>{if(playing){pause();status.textContent=tr('Náhled se načítá. Pokračuj tlačítkem Přehrát / pozastavit.')}});listen(v,'error',()=>{pause();status.textContent=tr('Náhled nelze přehrát v tomto prohlížeči.')})}
 const result=data.alignment,offset=make('p');offset.textContent=tr(result.reliable?'Posun mezi zvukovými stopami (ms):':'Posun zvuku nelze spolehlivě určit.')+(result.reliable?' '+result.offsetMs:'');
 const previewNote=data.previewProfile==='detail'?'Náhled pro obraz: H.264, 8bit SDR, mono AAC, nejvýše 1920 × 1080 px. Jde o nově vytvořenou ukázku; nenahrazuje posouzení nativní kvality ani HDR/Dolby Vision na vhodném zařízení.':'Náhled pro synchronizaci: H.264, 8bit SDR, mono AAC, nejvýše 960 × 540 px. Jde o nově vytvořenou ukázku; nenahrazuje posouzení nativní kvality ani HDR/Dolby Vision na vhodném zařízení.';
 host.append(make('p',previewNote),layoutControls,sourceLabels,pair,wipeControls,aspectWarning);
 if(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)host.append(make('p','Omezený pohyb je zapnutý. Automatický pohyb zapni jen podle vlastní potřeby.'));
 host.append(controls,seek,time,canvas,offset,status,make('p','Společný čas není důkaz správné synchronizace. Posuzuj pohyb úst nebo ruch proti obrazu. Krokování vychází z průměrné snímkové frekvence originálu; u proměnlivé frekvence je přibližné.'));
 setWipe(50);updateAspect();draw();return ()=>{if(dead)return;dead=true;pause();endDrag();for(const [node,event,fn]of listeners)node.removeEventListener(event,fn);videos.forEach(v=>{v.removeAttribute('src');v.load()});urls.forEach(url=>URL.revokeObjectURL(url));host.replaceChildren()};
}
