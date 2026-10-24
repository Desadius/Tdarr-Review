// Assemble the continuous assessment workspace while keeping saved evidence and playback controls separate.
export function mountContinuousReview(host,{item,session,observations={},hdrRequired=false,tr=x=>x,openGuidedComparison,playerOptions={},onCheck=()=>{},onNote=()=>{},onDevice=()=>{},onMethod=()=>{},onScope=()=>{},onComparison=()=>{},onSave=async()=>{},onDraft=async()=>{},onPreparation=()=>{},onPlaybackState=()=>{},onExternalReview=()=>{}}={}){
 const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=tr(text);return node};
 const root=make('section','continuous-review'),heading=make('h3','','Souvislé posouzení'),intro=make('p','details','Přehraj tři úseky v jednom průchodu. Přehrávání ani technická kontrola nic nepotvrzuje.');
 const media=make('div','continuous-review-media'),playerHost=make('div','continuous-review-player'),playbackStatus=make('p','details','Přehrávání ještě nezačalo.');playbackStatus.setAttribute('role','status');
 media.append(playerHost,playbackStatus);
 const controls=make('div','continuous-review-controls'),methodLabel=make('label','workflow-field','Způsob posouzení'),method=make('select');
 for(const [value,label]of [['review','Nástroje v Review'],['external','Vlastní přehrávač / TV']]){const option=make('option','',label);option.value=value;method.append(option)}method.value=session.method;method.dataset.workflowWrite='';method.onchange=()=>onMethod(method.value);methodLabel.append(method);controls.append(methodLabel);
 let device=null;
 if(hdrRequired||session.method==='external'){const label=make('label','workflow-field',hdrRequired?'Zařízení pro kontrolu HDR/Dolby Vision':'Přehrávač nebo zařízení'),input=make('input');input.maxLength=160;input.value=session.device;input.placeholder=tr('Například TV v obýváku · Plex');input.dataset.workflowWrite='';input.oninput=()=>onDevice(input.value);label.append(input);controls.append(label);device=input}
 if(session.method==='external')controls.append(make('p','details','Obraz, zvuk a synchronizaci potvrď podle vlastního přehrávání. Potvrzení vyplň až po dokončení kontroly.'));
 if(hdrRequired)controls.append(make('p','details','HDR/Dolby Vision ověř na vhodném zařízení. Náhled v prohlížeči převádí HDR do SDR.'));
 const evidence=make('fieldset','workflow-checks continuous-review-checks');evidence.append(make('legend','','Tvoje kontrola'));
 const specs=[['preparation','Ověřil jsem, že porovnávám správný originál a tento převod.'],['image','Zkontroloval jsem obraz a výsledek je pro mě přijatelný.'],...(hdrRequired?[['hdr','Ověřil jsem HDR/Dolby Vision na vhodném zařízení.']]:[]),['audio','Zkontroloval jsem vybraný pár zvukových stop a výsledek je pro mě přijatelný.'],['syncStart','Ověřil jsem synchronizaci v prvním úseku.'],['syncMiddle','Ověřil jsem synchronizaci v prostředním úseku.'],['syncEnd','Ověřil jsem synchronizaci v posledním úseku.']];
 const inputs=new Map(),savedText=new Map();
 for(const [key,labelText]of specs){const row=make('div','continuous-review-check-row'),label=make('label','workflow-confirmation'),input=make('input');input.type='checkbox';input.dataset.check=key;input.dataset.workflowWrite='';input.onchange=()=>onCheck(key,input.checked);label.append(input,make('span','',labelText));const saved=make('small','details');saved.dataset.observation=key;row.append(label,saved);evidence.append(row);inputs.set(key,input);savedText.set(key,saved)}
 const note=make('textarea');note.rows=3;note.maxLength=2000;note.value=session.note;note.placeholder=tr('Co jsi zjistil nebo co zbývá ověřit?');note.dataset.workflowWrite='';note.oninput=()=>onNote(note.value);
 const noteField=make('label','workflow-field','Poznámka k posouzení');noteField.append(note);
 const actions=make('div','workflow-actions'),save=make('button','primary','Uložit všechna potvrzení a pozorování'),draft=make('button','secondary','Uložit rozpracované posouzení'),defer=make('button','secondary','Odložit posouzení');save.type=draft.type=defer.type='button';save.dataset.workflowWrite='';save.dataset.guidedSave='';draft.dataset.workflowWrite='';defer.dataset.workflowWrite='';defer.dataset.guidedDefer='';
 let saving=false;
 const updateSave=state=>{const required=['preparation','image',...(hdrRequired?['hdr']:[]),'audio','syncStart','syncMiddle','syncEnd'];const ready=state&&!saving&&state.session?.method==='review'&&state.scopeValid&&required.every(key=>state.session?.checks?.[key]===true)&&(!hdrRequired||String(state.session?.device||'').trim().length>=2);save.dataset.invalid=String(!ready);save.disabled=!state?.allowed||!ready;draft.dataset.invalid=String(!state?.allowed);defer.dataset.invalid=String(!state?.allowed||!String(state?.session?.note||'').trim());defer.disabled=defer.dataset.invalid==='true'};
 save.onclick=async()=>{if(save.disabled||save.dataset.invalid==='true'||saving)return;saving=true;save.textContent=tr('Ukládám explicitní potvrzení…');refresh();try{await onSave()}finally{saving=false;save.textContent=tr('Uložit všechna potvrzení a pozorování');refresh()}};
 draft.onclick=async()=>{if(!draft.disabled&&!saving)await onDraft(false)};defer.onclick=async()=>{if(!defer.disabled&&!saving)await onDraft(true)};actions.append(save,draft,defer);
 const warning=make('p','details','Uložené pozorování se váže ke konkrétní stopě a času. Každá kontrola vyžaduje tvoje samostatné potvrzení.');
 root.append(heading,intro,media,controls,evidence,noteField,actions,warning);host.replaceChildren(root);
 const setPlayerStatus=value=>{
  let label='Přehrávání ještě nezačalo.';
  if(value?.status==='ended')label='Přehrávání dokončeno.';
  else if(value?.status==='error')label='Přehrávání selhalo.';
  else if(['playing','paused','suspended'].includes(value?.status)){
   const state=value.status==='playing'?'Přehrávání:':'Přehrávání pozastaveno:';
   const phase={original:'Originál',together:'Společně',transcode:'Převod'}[value.phase]||'Ukázka';
   label=`${tr(state)} ${Number(value.excerptIndex||0)+1}/${Number(value.excerptCount)||3} · ${tr(phase)}`;
  }
  playbackStatus.textContent=tr(label);onPlaybackState(value)
 };
 const playerCleanup=openGuidedComparison?.(item,{...playerOptions,host:playerHost,onScopeChange:onScope,onTimesChange:times=>onComparison({...playerOptions.comparison,excerpts:times}),onRoutingChange:value=>onComparison({...playerOptions.comparison,...value}),onPlaybackState:setPlayerStatus,onPreparation,onExternalReview,onExitPlayer:()=>inputs.get('preparation')?.focus()});
 function refresh(state={}){
  const current=state.session||session;for(const [key,input]of inputs)input.checked=current?.checks?.[key]===true;
  if(note.value!==current?.note)note.value=current?.note||'';if(device&&device.value!==(current?.device||''))device.value=current?.device||'';
  if(method.value!==current?.method)method.value=current?.method||'review';
  for(const [key,node]of savedText){const value=state.observations?.[key]||observations[key];node.textContent=value?(value.scope?.seconds===null?tr('Uloženo bez času kontrolovaného úseku.'):tr('Uloženo v čase:')+' '+Number(value.scope.seconds).toFixed(2)+' s'):tr('Kontrola zatím není uložená.')}
  updateSave(state);
 }
 refresh();return {refresh,destroy(){playerCleanup?.();root.replaceChildren();host.replaceChildren()}};
}
