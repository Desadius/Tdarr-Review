# Jednotné posouzení filmu — implementované chování

Stav verze **1.10.2** k 12. 10. 2026: jednotný proces je implementovaný, zdrojový release připravený a otestovaný. Prošel 297 testy na Linuxu, AV a HTTP ověřením; místní nasazená instance je zdravá a opětovné otevření uloženého posouzení prošlo kontrolou v UI. Publikace GitHub release a registry image jsou samostatné kroky. Tento dokument popisuje současný kód, nikoli pouze klikací návrh.

## Jeden film, jeden pracovní prostor

„Posoudit“ otevře záložku **Posouzení** a načte serverově uložený průběh pro aktuální dvojici originálu a review výsledku. Když je dostupné vestavěné řízené porovnání, výchozí cesta je průběžná pracovní plocha zaměřená na média: výběr páru stop, tři časy ukázek, přehrávač a ruční potvrzení jsou v jednom kontextu. Přehrávání nic samo nepotvrzuje. Externí přehrávač/TV a rozhodovací průběh mimo řízenou metodu nadále používají oddělené kroky.

Podklady a metadata, technické údaje a obnova mají samostatné záložky. Technické skóre zůstává souhrnem doložených kontrol; nedokončuje lidské posouzení ani nepředstavuje pravděpodobnost bezvadnosti filmu.

## Řízené porovnání a ruční potvrzení

Uživatel vybere odpovídající stopy originálu a výsledku, nastaví tři časy ukázek a zvolí režim přehrávání. Výchozí režim „Sluchátka“ přehraje pro každou ukázku tři fáze: originál v levém uchu, současně originál vlevo a výsledek vpravo, potom výsledek v pravém uchu. Tři ukázky tedy obsahují devět fází po nejvýše 12 sekundách, celkem nejvýše 108 sekund zvuku. Volitelný sekvenční režim přehraje originál a výsledek v samostatných fázích pro každou ukázku; šest fází trvá nejvýše 72 sekund. Volba prohození uší obrátí sluchátkové směrování.

Jeden výslovný začátek spustí průchod všemi fázemi. Obraz, zvuk a čas zůstávají v kontextu vybraného páru, tří časů a směrování. Přehrávač přehledně pozastaví práci při čekání na video, chybě nebo pozastavení mediálního kontextu prohlížečem. Obnovení či opakování vyžaduje výslovnou akci. Skryté normalizování hlasitosti ani automatické zarovnání offsetů se neprovádí.

Příprava, obraz, zvuk a každá ze tří synchronizačních ukázek mají samostatná ruční potvrzení. Uživatel může vše uložit jednou výslovnou akcí. Uložení zapisuje potvrzení postupně přes stávající CAS/revizní ochranu; pokud pozdější zápis selže, již uložené záznamy zůstanou a neuložená část zůstává jako draft. Každé synchronizační pozorování je svázáno se skutečným časem příslušné ukázky. Změna páru nebo kontextu porovnání zneplatní dotčená obrazová, zvuková a synchronizační potvrzení konzervativně. Schválení nikdy nevzniká automaticky.

## Ovládání a limity náhledů

Plovoucí lištu lze skrýt nebo ukotvit; po skrytí ji lze klávesou H znovu zobrazit. Zkratky působí pouze při zaměření přehrávače, ignorují editovatelná pole a respektují běžný fokus klávesnice. Mezi používané ovladače patří mezerník/K pro přehrát/pozastavit, šipky pro posun, M pro ztlumení, F pro celou obrazovku, ? pro nápovědu, závorky pro předchozí/další ukázku, R pro opakování a S pro zastavení. Escape nejdřív zavře nápovědu či režim celé obrazovky/zaměření a poté vrací fokus na ruční potvrzení. Posun a hlasitost mají také nativní posuvníky přístupné klávesnicí.

Režimy Fit, Stretch a Fill jsou místní preference prohlížeče a uplatňují se stejně na obě porovnávané strany. Režim 1:1 zobrazuje původní pixely statického snímku; krokování u VFR zůstává přibližné. Ukázkové video je omezený SDR převod a zvuk je mono 48 kHz. Náhled nedokládá nativní HDR, prostorový mix, původní rozlišení při přehrávání ani transparentnost kodeku. HDR/Dolby Vision proto stále vyžaduje samostatné potvrzení nativního přehrávání na pojmenovaném vhodném zařízení.

## Externí kontrola a HDR

„Vlastní přehrávač / TV“ umožňuje potvrdit již provedené posouzení aktuální review kopie bez generování ukázek v Review. Načítá se seznam stop a uživatel použije oddělený rozhodovací průběh. Název zařízení nebo přehrávače musí mít nejméně dva znaky po odstranění okrajových mezer. Stejná podmínka platí pro HDR/Dolby Vision i při použití nástrojů v Review. Požadavek HDR určuje server z aktuálních video streamů obou souborů: PQ, HLG nebo metadata Dolby Vision; obrázkové přílohy se nezapočítávají. Samostatné potvrzení HDR nelze nahradit přehráním SDR náhledu.

Změna způsobu kontroly nebo názvu zařízení zruší všechna potvrzení a vrátí průběh k podkladům. Změna páru stop zruší zvuk a synchronizační kontroly; změna času nebo směrování řízeného porovnání zneplatní dotčené řízené kontroly. Kontrola jiné či historické kopie se na aktuální výsledek nepřenáší.
## Rozpracování, odložení a zamítnutí

„Uložit rozpracované posouzení“ uloží aktuální krok a potvrzení na server. Serverový průběh lze načíst v další relaci. Prohlížeč navíc drží neuložený draft v `sessionStorage` pod ID a snapshotem položky; obnoví ho pouze při shodě se serverovou revizí. Neuložený draft není dokladem dokončení pro schválení.

„Odložit posouzení“ vyžaduje neprázdnou poznámku, která má popsat důvod a další krok, například kontrolu závěrečného dialogu na TV. Uloží stav `deferred`, ponechá oba soubory a zavře detail. Odložené posouzení je viditelné v seznamu a blokuje schválení i tehdy, když už obsahuje ostatní potvrzení. Při dalším pokračování se odložení výslovným uložením pokračujícího průběhu ruší.

„Zamítnout převod“ zůstává dostupné při splnění stávajících ochran bez nutnosti dokončit checklist. Samostatný potvrzovací dialog vyžaduje důvod; odstraní se pouze review kopie a důvod se archivuje. Žádost Radarru o jiné vydání je samostatná akce v záložce Obnova. Nevyhovující převod ani nejistá korelace samy nedokazují poškození originálu.

## Serverový záznam, CAS a schválení

Implementaci tvoří [review-session.mjs](../review/review-session.mjs), [review-workflow.js](../review/public/review-workflow.js) a napojení v [server.mjs](../review/server.mjs), [app.js](../review/public/app.js) a [review-model.js](../review/public/review-model.js). Pravidla, která používá server i prohlížeč, jsou jen jednou v [review-rules.js](../review/public/review-rules.js): seznam kontrol, kontroly jednotlivých kroků (HDR v kroku Obraz), dosažitelnost kroku (pár stop od Synchronizace), co ruší změna způsobu, zařízení nebo páru stop a požadavek na pojmenované zařízení. Server je jedinou autoritou pro uložení a dokončení posouzení. Prohlížeč je záměrně přísnější: zařízení a při HDR i jeho potvrzení vyžaduje už před přechodem do dalšího kroku, server až pro dokončení. [review-rules-table.test.mjs](../review/review-rules-table.test.mjs) obě strany ověřuje jednou tabulkou přechodů.

Záznam ve `state.reviewSessions` má ID položky, snapshot dvojice souborů, verzi checklistu `version: 1`, rostoucí `revision`, serverové požadavky, průběh, rozsah, jednotlivá pozorování a serverový čas aktualizace. Nová řízená metoda ukládá pouze volitelná metadata `comparison` verze 1 s režimem, prohozením uší a přesně třemi časy ukázek; staré záznamy bez těchto metadat zůstávají platné. Server metadata allowlistuje a ověřuje časy vůči kratší délce souboru. Jedno výslovné uložení může provést několik sekvenčních zápisů s CAS; konflikt zastaví další zápisy bez odstranění již přijatých potvrzení. Klientské časy pozorování nejsou autoritou. Server přijímá pouze explicitní booleany známých kontrol. Klientský příznak `complete`, diagnostický výstup ani podvržené časy pozorování dokončení neurčují. Ukládání neuvádí ověřenou osobní identitu; sdílený přístupový klíč takovou identitu nedokládá.

GET `/api/items/:id/review-session?snapshot=…` načte průběh pro aktuální kopie. POST stejné cesty předává `snapshot`, očekávanou `revision` a `session`. Uložení používá CAS: ověření revize, kontrola aktuálních souborů a metadata, validace a trvalý zápis probíhají v jedné frontě. Dvě relace se stejnou očekávanou revizí nemohou obě uspět. Konflikt vrací 409 a rozhraní nabídne načtení uloženého stavu. Při selhání trvalého zápisu se obnoví předchozí záznam a další uložení může pokračovat.

Změna snapshotu zneplatní dosavadní průběh; nelze schválit novou dvojici se starými potvrzeními. Odebrání požadované kontroly ruší dokončení. Rozhraní ruší i navazující potvrzení, která na ní závisejí. Schválení vyžaduje aktuální `reviewRevision`, neodložený dokončený checklist a platný snapshot. Finální dialog si revizi zapamatuje a při její změně vyžaduje nový souhlas. Server tyto podmínky ověřuje při přijetí požadavku i při zahájení výměny a kopii potvrzeného průběhu uloží do historie rozhodnutí.

Krok Rozhodnutí nabízí dvě oddělené akce. **Schválit** uloží trvalé rozhodnutí `state.approvals[id]` se snapshotem a revizí uloženého posouzení (`POST /api/items/:id/approval`); nepracuje se soubory, Tdarrem ani historií a neplánuje nahrazení. Film pak v přehledu nese stav „Schváleno · čeká na nahrazení“. Nové uložení posouzení nebo změna snapshotu rozhodnutí zneplatní; server zveřejňuje jen platná schválení. **Schválit a nahradit** zůstává dosavadním schválením s potvrzovacím dialogem. Hromadné nahrazení přijme jen filmy s platným schválením; před nahrazením každého filmu se jako dosud ověří snapshot a revize posouzení. Film s povoleným rozdílem délky se rozhoduje jen jednotlivě. Evidence Recovery a lhůta karantény začínají až skutečným nahrazením.

Dokončený checklist nepřekonává technické blokování, probíhající transakci, obnovu, neaktuální přihlášení nebo jiné stávající ochrany. Povolený rozdíl délky nadále vyžaduje samostatný výslovný souhlas s uvedenými hodnotami a kontrolou začátku, závěru a synchronizace; rozdíl se nepřejmenuje na shodu. Health check Tdarru se při schválení neopakuje. Kontrola průběhu čte aktuální metadata pomocí FFprobe a nepřidává plné dekódování filmu.

Hromadný výběr nabízí jen běžně schvalitelné položky s jednotlivě dokončeným posouzením aktuálních kopií. Každá položka v požadavku dávky nese ID, snapshot a `reviewRevision`. Server před zahájením kontroluje celou dávku; jedna neúplná, změněná nebo blokovaná položka zabrání startu všech. Po úspěšném preflightu probíhají jednotlivé výměny postupně s opakovanou kontrolou souborů. Chyba při běhu zachová soubory neúspěšné položky a dávka může pokračovat další. Výjimka rozdílu délky patří do individuálního rozhodnutí.

## Ověření verze 1.10.2 a stav release

Zdroj verze 1.10.2 prošel 297 testy na Linuxu a samostatným ověřením AV a HTTP integrace. Místní nasazená instance prošla health checkem a v prohlížeči bylo ověřeno opětovné otevření uloženého posouzení. Testy pokrývají nové ruční průběhy, neplatná potvrzení, obnovu a změnu snapshotu, páry stop a rozsah, jednotlivá synchronizační pozorování, externí zařízení, HDR, odložení, souběžný zápis se stejnou revizí a návrat po chybě zápisu. HTTP integrace používá dočasná média a mock Tdarru: ověřuje blokování neúplného checklistu, zastaralé revize, celou dávku před startem, postupné výměny, souběžné akce a zachování změněného zdroje. AV ověření pokrývá přípravu ukázek, časování a přehrávač.

Release 1.10.2 je připravený a otestovaný; místní nasazení je ověřené. To samo nepotvrzuje veřejnou dostupnost registry tagu ani neaktualizuje jiné instalace. Původní klikací koncept je podklad návrhu, zatímco zde popsaný serverový checklist a vložené nástroje jsou součástí implementace.
