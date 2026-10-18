# Jednotné posouzení filmu — implementované chování

Stav verze **1.10.2** k 12. 10. 2026: jednotný proces je implementovaný, zdrojový release připravený a otestovaný. Prošel 297 testy na Linuxu, AV a HTTP ověřením; místní nasazená instance je zdravá a opětovné otevření uloženého posouzení prošlo kontrolou v UI. Publikace GitHub release a registry image jsou samostatné kroky. Tento dokument popisuje současný kód, nikoli pouze klikací návrh.

## Jeden film, jeden pracovní prostor

„Posoudit“ otevře záložku **Posouzení** a načte serverově uložený průběh pro aktuální dvojici originálu a review výsledku. Pět kroků tvoří jednu pracovní plochu. Snímky, waveformy, sluchátkové A/B a AV přehrávač se vkládají přímo do příslušného kroku; sdílejí vybraný pár stop a čas úseku. Spuštění nástroje nevytváří nové potvrzení uživatele.

Podklady a metadata, technické údaje a obnova mají samostatné záložky. Technické skóre zůstává v technických údajích jako souhrn doložených kontrol. Nedokončuje lidské posouzení a nepředstavuje pravděpodobnost bezvadnosti filmu.

## Kroky a ruční potvrzení

1. **Podklady.** Uživatel zvolí „Nástroje v Review“ nebo „Vlastní přehrávač / TV“, vybere odpovídající stopu originálu a převodu, prohlédne velikosti a délky a případně stáhne výsledek. Potvrdí: „Ověřil jsem, že porovnávám správný originál a tento převod.“ Platný pár stop je potřebný pro pokračování i při externí kontrole.
2. **Obraz.** V režimu Review jsou na místě dostupné „Video a zvuk“ a „Statické snímky“ se zvětšením 1:1. Uživatel posoudí detaily, tmavé scény, pohyb a obraz přijme samostatným checkboxem. Pokud metadata originálu nebo výsledku vyžadují kontrolu HDR/Dolby Vision, přibude druhý, nezávislý checkbox pro kontrolu na vhodném pojmenovaném zařízení.
3. **Zvuk.** Uživatel porovná vybraný pár stop v poslechu a případně ve sluchátkovém A/B; waveformy poskytují pomůcku pro časování a hlasitost. Potvrdí přijatelnost právě vybraného páru, nikoli všech stop filmu. Dabing, originální dialog a komentář nejsou zaměnitelné.
4. **Synchronizace.** AV nástroj a tři ruční potvrzení jsou přímo v kroku. Začátek, střed a konec mají každý vlastní tlačítko „Uložit kontrolu …“. Uživatel vybere vhodný úsek, posoudí řeč nebo ruch proti obrazu, zaškrtne příslušnou kontrolu a uloží ji. „Uložit a pokračovat“ se povolí až po uložení všech tří kontrol. Obecné uložení rozpracovaného posouzení samostatná uložení nových synchronizačních potvrzení nenahrazuje.
5. **Rozhodnutí.** Souhrn ukazuje potvrzené oblasti, způsob posouzení, zařízení a uložené časy tří synchronizačních kontrol. Schválení je dostupné až pro dokončený uložený průběh bez neuložených změn a při splnění stávajících technických a provozních podmínek. Následuje zvláštní finální dialog souhlasu s nahrazením originálu a odstraněním původní verze.

Ruční checkboxy jsou součástí jednotlivých kroků, nikoli pouze závěrečného seznamu. „Uložit a pokračovat“ uloží potvrzení a posune průběh. Již dosažené kroky lze znovu otevřít; budoucí kroky se nezpřístupňují pouhou navigací. Načtení snímků, stažení výsledku, přehrání nebo dohrání ukázky ani dobrá korelace nic automaticky nezaškrtávají. Uložení kroku samo výměnu souborů nespouští.

## Rozsah potvrzení a meze náhledů

Server eviduje pro obraz, HDR, zvuk a každý synchronizační úsek samostatný záznam `observations`. Obsahuje způsob posouzení, zařízení, vybraný pár stop, čas úseku a čas potvrzení určený serverem. Změna času další ukázky nepřepíše již uložený čas předchozí kontroly. Opakované uložení dosud platného potvrzení zachovává jeho původní záznam; odebrání potvrzení záznam odstraní a nové potvrzení vytvoří nový rozsah.

`scope` obsahuje `originalIndex`, `reviewIndex` a `seconds`. Jde o konkrétní pár a jeden čas u daného potvrzení, nikoli o seznam všech prohlédnutých scén nebo důkaz úplného sledování filmu. Externí kontrola může uložit čas jako `null`; rozhraní to označí jako uložení bez času kontrolovaného úseku. Server ověřuje existenci zvolených streamů a platnost případného času vůči kratšímu souboru. Neověřuje skutečné zhlédnutí ani to, zda uživatel pro „začátek“ nebo „konec“ vybral první či poslední dialogovou scénu; toto zůstává jeho výslovným potvrzením.

Statické snímky nedokládají plynulost. AV ukázka používá H.264, mono AAC a převod HDR do SDR. Detailnější obrazový profil má nejvýše 1920 × 1080 px, rychlejší profil pro synchronizaci 960 × 540. Videa lze zobrazit v jedné ploše s ruční dělicí čárou nebo vedle sebe. Volitelný automatický pohyb mezi 25 % a 75 % běží pouze při přehrávání a nevytváří potvrzení kontroly. Sluchátkové A/B převádí zvuk do mono 48 kHz. Tyto nástroje nedokládají prostorový mix, výslednou věrnost HDR ani kvalitu obrazu v původním rozlišení. Korelace obálek porovnává časování dvou zvukových stop; nulový vzájemný posun nedokazuje soulad s pohybem úst. AV přehrávač označuje vlastní resynchronizaci a přibližné krokování podle průměrné snímkové frekvence u VFR.

## Externí kontrola a HDR

„Vlastní přehrávač / TV“ umožňuje potvrdit již provedené posouzení aktuální review kopie bez generování ukázek v Review. Načítá se seznam stop a uživatel ručně projde stejné kroky včetně tří samostatně uložených kontrol synchronizace. Nejde o jediné hromadné potvrzení všech oblastí.

Externí režim vyžaduje název zařízení nebo přehrávače o nejméně dvou znacích po odstranění okrajových mezer. Stejná podmínka platí pro HDR/Dolby Vision i v režimu „Nástroje v Review“. Požadavek HDR určuje server z aktuálních video streamů obou souborů: PQ, HLG nebo metadata Dolby Vision; obrázkové přílohy se nezapočítávají. Samostatné potvrzení HDR nelze nahradit přehráním SDR náhledu.

Změna způsobu kontroly nebo názvu zařízení zruší všechna potvrzení a vrátí průběh k podkladům. Změna páru stop zruší zvuk a všechny tři synchronizační kontroly a vrátí průběh nejvýše ke zvuku; platné posouzení obrazu zůstane zachované. Změněná identita kontroly se ukládá před novými potvrzeními, aby jedno potvrzení nemohlo současně popisovat starý i nový rozsah. Kontrola jiné nebo historické kopie se na aktuální výsledek nepřenáší.

## Rozpracování, odložení a zamítnutí

„Uložit rozpracované posouzení“ uloží aktuální krok a potvrzení na server. Serverový průběh lze načíst v další relaci. Prohlížeč navíc drží neuložený draft v `sessionStorage` pod ID a snapshotem položky; obnoví ho pouze při shodě se serverovou revizí. Neuložený draft není dokladem dokončení pro schválení.

„Odložit posouzení“ vyžaduje neprázdnou poznámku, která má popsat důvod a další krok, například kontrolu závěrečného dialogu na TV. Uloží stav `deferred`, ponechá oba soubory a zavře detail. Odložené posouzení je viditelné v seznamu a blokuje schválení i tehdy, když už obsahuje ostatní potvrzení. Při dalším pokračování se odložení výslovným uložením pokračujícího průběhu ruší.

„Zamítnout převod“ zůstává dostupné při splnění stávajících ochran bez nutnosti dokončit checklist. Samostatný potvrzovací dialog vyžaduje důvod; odstraní se pouze review kopie a důvod se archivuje. Žádost Radarru o jiné vydání je samostatná akce v záložce Obnova. Nevyhovující převod ani nejistá korelace samy nedokazují poškození originálu.

## Serverový záznam, CAS a schválení

Implementaci tvoří [review-session.mjs](../review/review-session.mjs), [review-workflow.js](../review/public/review-workflow.js) a napojení v [server.mjs](../review/server.mjs), [app.js](../review/public/app.js) a [review-model.js](../review/public/review-model.js).

Záznam ve `state.reviewSessions` má ID položky, snapshot dvojice souborů, verzi checklistu `version: 1`, rostoucí `revision`, serverové požadavky, průběh, rozsah, jednotlivá pozorování a serverový čas aktualizace. Server přijímá pouze explicitní booleany známých kontrol. Klientský příznak `complete`, diagnostický výstup ani podvržené časy pozorování dokončení neurčují. Ukládání neuvádí ověřenou osobní identitu; sdílený přístupový klíč takovou identitu nedokládá.

GET `/api/items/:id/review-session?snapshot=…` načte průběh pro aktuální kopie. POST stejné cesty předává `snapshot`, očekávanou `revision` a `session`. Uložení používá CAS: ověření revize, kontrola aktuálních souborů a metadata, validace a trvalý zápis probíhají v jedné frontě. Dvě relace se stejnou očekávanou revizí nemohou obě uspět. Konflikt vrací 409 a rozhraní nabídne načtení uloženého stavu. Při selhání trvalého zápisu se obnoví předchozí záznam a další uložení může pokračovat.

Změna snapshotu zneplatní dosavadní průběh; nelze schválit novou dvojici se starými potvrzeními. Odebrání požadované kontroly ruší dokončení. Rozhraní ruší i navazující potvrzení, která na ní závisejí. Schválení vyžaduje aktuální `reviewRevision`, neodložený dokončený checklist a platný snapshot. Finální dialog si revizi zapamatuje a při její změně vyžaduje nový souhlas. Server tyto podmínky ověřuje při přijetí požadavku i při zahájení výměny a kopii potvrzeného průběhu uloží do historie rozhodnutí.

Krok Rozhodnutí nabízí dvě oddělené akce. **Schválit** uloží trvalé rozhodnutí `state.approvals[id]` se snapshotem a revizí uloženého posouzení (`POST /api/items/:id/approval`); nepracuje se soubory, Tdarrem ani historií a neplánuje nahrazení. Film pak v přehledu nese stav „Schváleno · čeká na nahrazení“. Nové uložení posouzení nebo změna snapshotu rozhodnutí zneplatní; server zveřejňuje jen platná schválení. **Schválit a nahradit** zůstává dosavadním schválením s potvrzovacím dialogem. Hromadné nahrazení přijme jen filmy s platným schválením; před nahrazením každého filmu se jako dosud ověří snapshot a revize posouzení. Film s povoleným rozdílem délky se rozhoduje jen jednotlivě. Evidence Recovery a lhůta karantény začínají až skutečným nahrazením.

Dokončený checklist nepřekonává technické blokování, probíhající transakci, obnovu, neaktuální přihlášení nebo jiné stávající ochrany. Povolený rozdíl délky nadále vyžaduje samostatný výslovný souhlas s uvedenými hodnotami a kontrolou začátku, závěru a synchronizace; rozdíl se nepřejmenuje na shodu. Health check Tdarru se při schválení neopakuje. Kontrola průběhu čte aktuální metadata pomocí FFprobe a nepřidává plné dekódování filmu.

Hromadný výběr nabízí jen běžně schvalitelné položky s jednotlivě dokončeným posouzením aktuálních kopií. Každá položka v požadavku dávky nese ID, snapshot a `reviewRevision`. Server před zahájením kontroluje celou dávku; jedna neúplná, změněná nebo blokovaná položka zabrání startu všech. Po úspěšném preflightu probíhají jednotlivé výměny postupně s opakovanou kontrolou souborů. Chyba při běhu zachová soubory neúspěšné položky a dávka může pokračovat další. Výjimka rozdílu délky patří do individuálního rozhodnutí.

## Ověření verze 1.10.2 a stav release

Zdroj verze 1.10.2 prošel 297 testy na Linuxu a samostatným ověřením AV a HTTP integrace. Místní nasazená instance prošla health checkem a v prohlížeči bylo ověřeno opětovné otevření uloženého posouzení. Testy pokrývají nové ruční průběhy, neplatná potvrzení, obnovu a změnu snapshotu, páry stop a rozsah, jednotlivá synchronizační pozorování, externí zařízení, HDR, odložení, souběžný zápis se stejnou revizí a návrat po chybě zápisu. HTTP integrace používá dočasná média a mock Tdarru: ověřuje blokování neúplného checklistu, zastaralé revize, celou dávku před startem, postupné výměny, souběžné akce a zachování změněného zdroje. AV ověření pokrývá přípravu ukázek, časování a přehrávač.

Release 1.10.2 je připravený a otestovaný; místní nasazení je ověřené. To samo nepotvrzuje veřejnou dostupnost registry tagu ani neaktualizuje jiné instalace. Původní klikací koncept je podklad návrhu, zatímco zde popsaný serverový checklist a vložené nástroje jsou součástí implementace.
