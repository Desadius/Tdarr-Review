function removedSummary(tracks){const counts=new Map();for(const t of tracks){const [type,,,language]=t.split('|');const key=(type==='audio'?'zvuk ':'titulky ')+(language||'neoznačeno');counts.set(key,(counts.get(key)||0)+1)}return [...counts].map(([label,n])=>label+(n>1?' ×'+n:'')).join(', ')||'žádné'}
export function assessment(item,info,{job=false,health='unknown',samples=[]}={}){
 const markers=[];const add=(label,weight,status,detail)=>markers.push({label,weight,status,detail});
 add('Přiřazení úlohy',10,job?'pass':'unknown',job?'Úspěšná úloha odpovídá cestě a velikostem obou souborů.':'Chybí potvrzená odpovídající úloha.');
 add('Úplný health check Tdarru',25,health,health==='pass'?'Log potvrzuje dekódování hlavního videa a všech zvukových stop.':health==='fail'?'Log hlásí chybu health checku.':'Průkazný výsledek v logu není dostupný.');
 const verified=info?.evidenceVersion===1;
 add('Parametry obrazu',15,verified?'pass':'unknown',verified?`${info.videoSummary}. Shoda rozlišení a kontrol podporovaného profilu.`:'Parametry zatím nejsou doložené.');
 add('Délka',15,verified?(info.durationMismatch?'fail':'pass'):'unknown',verified?`Originál ${info.durationA.toFixed(3)} s; výstup ${info.durationB.toFixed(3)} s; rozdíl ${(info.durationB-info.durationA).toFixed(3)} s.`:'Délka zatím není ověřena.');
 add('Zvukové a titulkové stopy',15,verified?'pass':'unknown',verified?`Zvuk ${info.audioBefore} → ${info.audio.length}; titulky ${info.subtitlesBefore} → ${info.subtitles.length}. Výstupní kodeky, jazyky a kanály odpovídají zdroji. Odebrané stopy: ${removedSummary(info.removedTracks)}.`:'Shoda stop zatím není ověřena.');
 add('Kapitoly',5,verified?'pass':'unknown',verified?`Shodný počet: ${info.chapterCount}. Časy kapitol se tímto nehodnotí.`:'Počet kapitol zatím není ověřen.');
 const groups=new Map();for(const s of samples){const key=s.originalIndex+':'+s.reviewIndex;const list=groups.get(key)||[];list.push(s);groups.set(key,list)}
 const usable=[...groups.values()].find(list=>[.1,.5,.9].every(target=>list.some(s=>Math.abs(s.seconds/info?.durationB-target)<.15&&s.alignment?.reliable&&Math.abs(s.alignment.offsetMs)<=20)));
 const shifted=samples.some(s=>s.alignment?.reliable&&Math.abs(s.alignment.offsetMs)>20);
 add('Vzorky synchronizace',15,shifted?'fail':usable?'pass':'unknown',shifted?'Alespoň jeden porovnaný úsek hlásí posun nad 20 ms. Ověř výběr stejných stop.':usable?'Stejný pár stop: vzorky u začátku, uprostřed a u konce mají posun nejvýše 20 ms. Netestuje ostatní stopy ani pohyb úst.':`Chybí průkazné vzorky stejného páru stop na začátku, uprostřed a na konci. Uloženo měření: ${samples.length}.`);
 const score=markers.filter(m=>m.status==='pass').reduce((n,m)=>n+m.weight,0),issues=markers.filter(m=>m.status==='fail');
 return {score,maximum:100,markers,verdict:item.status==='blocked'?'Schválení blokované — vyřeš uvedený důvod':issues.length?'Zjištěná odchylka — vyžaduje kontrolu':'Doložené kontroly bez zjištěné odchylky',note:'Body jsou vážený součet doložených kontrol, nikoli procentní pravděpodobnost bezvadnosti. Neznámé kontroly mají 0 bodů. Vizuální kvalita komprese a soulad řeči s pohybem úst vyžadují posouzení při přehrávání.'};
}
