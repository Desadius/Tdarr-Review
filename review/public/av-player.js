export function mountAVComparison(host,data,{tr=x=>x}={}){
 const make=(tag,text)=>{const x=document.createElement(tag);if(text)x.textContent=tr(text);return x};
 const urls=[],videos=[],pair=make('div');pair.className='av-pair';let dead=false,raf=0,playing=false,sound=0,lastSync=0;
 const status=make('p');status.setAttribute('role','status');
 for(const [i,name] of ['Originál','Převod'].entries()){
  const figure=make('figure'),v=make('video');v.playsInline=true;v.preload='auto';v.muted=i!==sound;v.volume=.5;v.controls=false;
  const bytes=Uint8Array.from(atob(i?data.review:data.original),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));urls.push(url);v.src=url;videos.push(v);figure.append(make('figcaption',name),v);pair.append(figure);
 }
 const controls=make('div');controls.className='comparison-controls';const play=make('button','Přehrát / pozastavit'),back=make('button','Předchozí snímek'),next=make('button','Další snímek'),audio=make('select'),volume=make('input');
 for(const [i,name] of ['Zvuk originálu','Zvuk převodu','Bez zvuku'].entries()){const o=make('option',name);o.value=String(i);audio.append(o)}audio.setAttribute('aria-label',tr('Přehrávaný zvuk'));
 volume.type='range';volume.min='0';volume.max='1';volume.step='.05';volume.value='.5';volume.setAttribute('aria-label',tr('Společná hlasitost'));
 controls.append(play,back,next,audio,volume);const seek=make('input');seek.type='range';seek.min='0';seek.max=String(data.duration);seek.step='.01';seek.value='0';seek.setAttribute('aria-label',tr('Společná časová osa'));seek.className='av-seek';const time=make('output');
 const canvas=make('canvas');canvas.width=1100;canvas.height=220;canvas.style.width='100%';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',tr('Zvukové průběhy originálu a převodu na společné časové ose'));
 const draw=()=>{const c=canvas.getContext('2d'),max=Math.max(.001,...data.originalWave,...data.reviewWave);c.fillStyle='#111827';c.fillRect(0,0,1100,220);
  for(const [wave,title,color,base] of [[data.originalWave,'Originál','#38bdf8',90],[data.reviewWave,'Převod','#fbbf24',175]]){c.fillStyle=color;c.font='14px sans-serif';c.fillText(tr(title),12,base-50);c.strokeStyle=color;c.beginPath();wave.forEach((v,i)=>{const x=85+i/(data.duration*100)*990,y=base-v/max*45;i?c.lineTo(x,y):c.moveTo(x,y)});c.stroke()}
  const x=85+Number(seek.value)/data.duration*990;c.strokeStyle='#fff';c.beginPath();c.moveTo(x,20);c.lineTo(x,190);c.stroke();c.fillStyle='#ddd';for(let i=0;i<=data.duration;i+=2)c.fillText((data.seconds+i).toFixed(1)+' s',85+i/data.duration*990-20,210);
  time.value=(data.seconds+Number(seek.value)).toFixed(2)+' s';
 };
 const pause=()=>{playing=false;videos.forEach(v=>v.pause());cancelAnimationFrame(raf)};
 const duration=()=>Math.min(data.duration,...videos.map(v=>Number.isFinite(v.duration)?v.duration:data.duration));
 const move=value=>{pause();const t=Math.max(0,Math.min(duration(),value));videos.forEach(v=>v.currentTime=t);seek.value=String(t);draw()};
 const tick=()=>{if(dead||!playing)return;seek.value=String(videos[0].currentTime);const drift=videos[1].currentTime-videos[0].currentTime;
  if(Math.abs(drift)>.08&&performance.now()-lastSync>500&&!videos[1].seeking){videos[1].currentTime=videos[0].currentTime;lastSync=performance.now();status.textContent=tr('Přehrávače byly znovu synchronizovány. Při posuzování drobného posunu použij krokování.')}
  draw();if(videos[0].currentTime>=duration()-.03)pause();else raf=requestAnimationFrame(tick);
 };
 play.onclick=async()=>{if(playing){pause();return}try{if(videos[0].currentTime>=duration()-.05)move(0);await Promise.all(videos.map(v=>v.play()));if(dead){pause();return}playing=true;status.textContent=tr('Přehrávání společného úseku.');tick()}catch{pause();status.textContent=tr('Náhled nelze přehrát v tomto prohlížeči.')}};
 const rate=data.frameRates?.[0],step=rate&&rate<=120?1/rate:1/24;back.onclick=()=>move(videos[0].currentTime-step);next.onclick=()=>move(videos[0].currentTime+step);
 seek.oninput=()=>move(Number(seek.value));canvas.onclick=e=>{const rect=canvas.getBoundingClientRect();move(((e.clientX-rect.left)/rect.width*1100-85)/990*data.duration)};
 audio.onchange=()=>{sound=Number(audio.value);videos.forEach((v,i)=>v.muted=i!==sound)};volume.oninput=()=>videos.forEach(v=>v.volume=Number(volume.value));
 for(const v of videos){v.addEventListener('ended',pause);v.addEventListener('waiting',()=>{if(playing){pause();status.textContent=tr('Náhled se načítá. Pokračuj tlačítkem Přehrát / pozastavit.')}});v.addEventListener('error',()=>{pause();status.textContent=tr('Náhled nelze přehrát v tomto prohlížeči.')})}
 const result=data.alignment;const offset=make('p');offset.textContent=tr(result.reliable?'Posun mezi zvukovými stopami (ms):':'Posun zvuku nelze spolehlivě určit.')+(result.reliable?' '+result.offsetMs:'');
 host.append(make('p','Náhled: H.264, mono AAC, nejvýše 960 px. HDR se převádí do SDR. Ukázka slouží k synchronizaci, nikoli k posouzení HDR nebo prostorového zvuku.'),pair,controls,seek,time,canvas,offset,status,make('p','Společný čas není důkaz správné synchronizace. Posuzuj pohyb úst nebo ruch proti obrazu. Krokování vychází z průměrné snímkové frekvence originálu; u proměnlivé frekvence je přibližné.'));
 draw();return ()=>{dead=true;pause();videos.forEach(v=>{v.removeAttribute('src');v.load()});urls.forEach(url=>URL.revokeObjectURL(url));host.replaceChildren()};
}
