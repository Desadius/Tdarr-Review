import sharedSettingsMessages from './shared-settings-messages.js?v=__APP_VERSION__';
import guidedMessages from './guided-messages.js?v=__APP_VERSION__';
import {ERROR_MESSAGES} from './error-messages.js?v=__APP_VERSION__';
export default {
  "exact": {...Object.fromEntries(Object.values(ERROR_MESSAGES).map(message=>[message.cs,message.en])),...sharedSettingsMessages,...guidedMessages,
    "Nastavení právě používá jiná operace. Zkus to za chvíli.": "Another operation is using settings. Try again shortly.",
    "Diagnóza importu": "Import diagnosis",
    "Nesoulad jazyka nebo kvality; podrobnosti ověř v Radarru.": "Language or quality mismatch; check Radarr for details.",
    "Stahování stále probíhá; podrobnosti ověř ve frontě Radarru.": "The download is still in progress; check the Radarr queue for details.",
    "Radarr hlásí problém při importu; vyřeš ho v Radarru.": "Radarr reports an import problem; resolve it in Radarr.",
    "Příčina není jednoznačná; podrobnosti ověř ve frontě Radarru.": "The cause is unclear; check the Radarr queue for details.",
    "Diagnóza importu zatím není ověřena. Obnov stav ručně.": "The import diagnosis is unverified. Refresh status manually.",
    "Diagnózu importu se nepodařilo ověřit. Obnov stav ručně.": "The import diagnosis could not be verified. Refresh status manually.",
    "Otevřít ověřený film v Radarru": "Open the verified movie in Radarr",
    "Otevřít frontu Radarru": "Open the Radarr Activity/Queue",
    "Otevře obecnou frontu Radarru; nic nemění.": "Opens the general Radarr queue; changes nothing.",
    "Vrátit pouze původní soubor": "Restore only the original file",
    "VRÁCENÍ POUZE PŮVODNÍHO SOUBORU": "RESTORE THE ORIGINAL FILE ONLY",
    "Vrátit do knihovny přesně uložený původní soubor? Recovery ho dříve označila jako poškozený, takže může být stále vadný. Akce vrátí jen tento soubor do původní prázdné cesty; nepřesune převod, neschválí jej a nemění lhůtu karantény, profily Radarru ani neprokázané Holds Tdarru. Review znovu ověří soubory, Radarr, frontu a Tdarr a koordinuje Recovery.": "Restore the exact preserved original to its empty original path? Recovery previously marked it as faulty, so it may still be damaged. This returns only that file; it does not move a transcode, approve it, change quarantine retention, change Radarr profiles or alter unproven Tdarr Holds. Review rechecks the files, Radarr, its queue and Tdarr, and coordinates Recovery.",
    "Vrátit pouze originál": "Restore the original only",
    "Obnova původního souboru probíhá…": "Restoring the original file…",
    "Obnovení dokončeno. Originál může být stále vadný; schválení ani úklid karantény se nezměnily.": "Restore completed. The original may still be faulty; approval and quarantine cleanup were not changed.",
    "Obnova je zablokovaná; pokračuj explicitním ověřením stavu.": "The restore is blocked; explicitly reconcile its status to continue.",
    "Ověřit uložený výsledek": "Reconcile the saved result",
    "NEJASNÝ STAV NÁVRATU ORIGINÁLU": "UNCERTAIN ORIGINAL RESTORE",
    "Review znovu ověří pouze trvalý záznam a soubory. Nejasnou operaci znovu nespustí a nevymaže bezpečnostní zábranu bez důkazu.": "Review will verify only the durable record and files. It will not rerun an uncertain operation or clear the safety fence without proof.",
    "Originál teď nelze bezpečně vrátit. Ověř stav Radarru, Tdarru a Recovery.": "The original cannot be safely restored now. Check Radarr, Tdarr and Recovery.",
    "Stav návratu originálu nelze načíst.": "The original restore status could not be loaded.",
    "Stav Recovery nelze ověřit; předání Tdarru čeká a Hold zůstává.": "Recovery's state cannot be verified; the Tdarr handoff waits and the Hold stays.",
    "Nastavení se změnilo. Načti aktuální návrh a zkus to znovu.": "Settings changed. Reload the current draft and try again.",
    "Relace řízení Recovery vypršela.": "Recovery control session expired.",
    "Správce Recovery se ukončuje.": "Recovery supervisor stopping.",
    "Použití změn Recovery již probíhá.": "Recovery apply already pending.",
    "Identifikátor požadavku Recovery vypršel.": "Recovery request id expired.",
    "Požadavek Recovery vypršel.": "Recovery request expired.",
    "Tento požadavek Recovery již nelze zrušit.": "Recovery request cannot be cancelled.",
    "Proces Recovery není dostupný.": "Recovery worker unavailable.",
    "Recovery ještě nedokončilo probíhající operaci.": "Recovery is not drained.",
    "Recovery ještě není zastavené.": "Recovery is not stopped.",
    "Neplatná akce řízení Recovery.": "Unknown Recovery control action.",
    "Správce Recovery není dostupný.": "Recovery supervisor unavailable.",
    "Neplatný identifikátor požadavku Recovery.": "Invalid Recovery control request id.",
    "Počkej na načtení průběhu posouzení.": "Wait for the review progress to load.",
    "Načti aktuální uložený stav posouzení z jiné relace.": "Load the current saved review from the other session.",
    "Počkej na dokončení ukládání posouzení.": "Wait for the review to finish saving.",
    "Počkej na dokončení jiné akce nebo obnovy a obnov aktuální údaje.": "Wait for another action or recovery to finish and refresh the current data.",
    "Vyplň přehrávač nebo zařízení pro kontrolu HDR/Dolby Vision (alespoň dva znaky).": "Enter a player or device for the HDR/Dolby Vision check (at least two characters).",
    "Vyplň přehrávač nebo zařízení pro externí kontrolu (alespoň dva znaky).": "Enter a player or device for the external check (at least two characters).",
    "Vyber platný pár zvukových stop originálu a převodu.": "Select a valid pair of original and transcoded audio tracks.",
    "Vyber platný časový úsek ukázky.": "Select a valid sample interval.",
    "Potvrď, že porovnáváš správný originál a tento převod.": "Confirm that you are comparing the correct original and this transcode.",
    "Potvrď, že jsi zkontroloval obraz a výsledek je přijatelný.": "Confirm that you checked the picture and the result is acceptable.",
    "Potvrď kontrolu HDR/Dolby Vision na vhodném zařízení.": "Confirm the HDR/Dolby Vision check on a suitable device.",
    "Potvrď kontrolu vybraného páru zvukových stop.": "Confirm the check of the selected audio tracks.",
    "Potvrď synchronizaci na začátku filmu.": "Confirm synchronisation at the beginning of the film.",
    "Potvrď synchronizaci uprostřed filmu.": "Confirm synchronisation in the middle of the film.",
    "Potvrď synchronizaci na konci filmu.": "Confirm synchronisation at the end of the film.",
    "Ulož kontrolu synchronizace na začátku filmu.": "Save the synchronisation check at the beginning of the film.",
    "Ulož kontrolu synchronizace uprostřed filmu.": "Save the synchronisation check in the middle of the film.",
    "Ulož kontrolu synchronizace na konci filmu.": "Save the synchronisation check at the end of the film.",
    "Než bude možné uložit a pokračovat:": "Before you can save and continue:",
    "Souvislé posouzení": "Continuous review",
    "Přehraj tři úseky v jednom průchodu. Přehrávání ani technická kontrola nic nepotvrzuje.": "Play all three excerpts in one pass. Playback and technical checks never confirm observations.",
    "Přehrávání ještě nezačalo.": "Playback has not started.",
    "Přehrávání:": "Playing:",
    "Přehrávání pozastaveno:": "Paused:",
    "Přehrávání dokončeno.": "Playback complete.",
    "Přehrávání selhalo.": "Playback failed.",
    "Ukázka": "Excerpt",
    "Společně": "Together",
    "Nástroje v Review": "Review tools",
    "Vlastní přehrávač / TV": "External player / TV",
    "Zařízení pro kontrolu HDR/Dolby Vision": "Device for HDR/Dolby Vision review",
    "Přehrávač nebo zařízení": "Player or device",
    "Například TV v obýváku · Plex": "For example, living room TV · Plex",
    "Obraz, zvuk a synchronizaci potvrď podle vlastního přehrávání. Potvrzení vyplň až po dokončení kontroly.": "Confirm picture, audio, and sync based on your own playback. Check the boxes only after reviewing.",
    "HDR/Dolby Vision ověř na vhodném zařízení. Náhled v prohlížeči převádí HDR do SDR.": "Check HDR/Dolby Vision on a suitable device. The browser preview converts HDR to SDR.",
    "Tvoje kontrola": "Your review",
    "Ověřil jsem, že porovnávám správný originál a tento převod.": "I confirmed that I am comparing the correct original and this transcode.",
    "Zkontroloval jsem obraz a výsledek je pro mě přijatelný.": "I checked the picture and accept the result.",
    "Ověřil jsem HDR/Dolby Vision na vhodném zařízení.": "I checked HDR/Dolby Vision on a suitable device.",
    "Zkontroloval jsem vybraný pár zvukových stop a výsledek je pro mě přijatelný.": "I checked the selected audio tracks and accept the result.",
    "Ověřil jsem synchronizaci v prvním úseku.": "I checked synchronisation in the first excerpt.",
    "Ověřil jsem synchronizaci v prostředním úseku.": "I checked synchronisation in the middle excerpt.",
    "Ověřil jsem synchronizaci v posledním úseku.": "I checked synchronisation in the final excerpt.",
    "Uloženo bez času kontrolovaného úseku.": "Saved without an excerpt time.",
    "Uloženo v čase:": "Saved at:",
    "Kontrola zatím není uložená.": "This check is not saved yet.",
    "Co jsi zjistil nebo co zbývá ověřit?": "What did you find, or what remains to be checked?",
    "Poznámka k posouzení": "Review note",
    "Uložit všechna potvrzení a pozorování": "Save all confirmations and observations",
    "Ukládám explicitní potvrzení…": "Saving explicit confirmations…",
    "Uložit rozpracované posouzení": "Save draft review",
    "Uložené pozorování se váže ke konkrétní stopě a času. Každá kontrola vyžaduje tvoje samostatné potvrzení.": "Saved observations are tied to a specific track and time. Each check requires your explicit confirmation.",
    "Pozastaveno režimem Verify": "Paused by Verify",
    "Originál je déle než 24 hodin mimo knihovnu": "Original outside the library for over 24 hours",
    "Pokud stahování v Radarru visí, odstraň ho v Radarru; Recovery při příští kontrole vrátí originál do knihovny.": "If the download in Radarr is stuck, remove it in Radarr; Recovery returns the original to the library on its next poll.",
    "Originál je mimo knihovnu déle než 24 hodin. Pokud stahování náhrady v Radarru visí, odstraň ho v Radarru; Recovery pak při příští kontrole vrátí originál do knihovny.": "The original has been outside the library for more than 24 hours. If the replacement download in Radarr is stuck, remove it in Radarr; Recovery then returns the original to the library on its next poll.",
    "Pozastaveno režimem Verify; pokračují pouze ochranné kroky.": "Paused by Verify; only protective steps continue.",
    "Čeká: odebrání zachovaného originálu a vyžádání náhrady.": "Waiting to remove the kept original and request a replacement.",
    "Čeká: předání náhrady Tdarru.": "Waiting to hand the replacement to Tdarr.",
    "Čeká: úklid karantény.": "Waiting to purge quarantine.",
    "Originál je mimo knihovnu, zachovaný v karanténě.": "The original is outside the library, preserved in quarantine.",
    "Originál je v knihovně.": "The original is in the library.",
    "Umístění originálu není doloženo.": "The original location is not recorded.",
    "Mimo knihovnu od:": "Outside the library since:",
    "Vráceno do knihovny:": "Returned to the library:",
    "Po přepnutí na Repair Recovery znovu ověří aktuální stav a automaticky pokračuje.": "After switching to Repair, Recovery revalidates the current state and resumes automatically.",

    "Ověř kompatibilitu dekodéru nebo vyžádej novou výslovně povolenou náhradu. Originál zůstává zachovaný; tento případ nepovoluje automatické nahrazení.": "Check decoder compatibility or request a newly and explicitly authorized replacement. The original remains preserved; this case grants no automatic replacement authority.",
    "Chybí přesná historie vydání. Zachovej originál a zkontroluj údaje v Radarru; případná náhrada potřebuje nové výslovné oprávnění.": "Exact release history is missing. Preserve the original and inspect the Radarr records; any replacement needs new explicit authorization.",
    "Restart nebo aktualizace kontejneru s Review přeruší Recovery. Počkej na dokončení kontroly originálu nebo změn prováděných Recovery. Přerušená kontrola není důkazem poškození.": "Restarting or updating the container running Review interrupts Recovery. Wait for the original check or changes made by Recovery to finish. An interrupted check is not evidence of corruption.",
    "Stav Recovery": "Recovery status",
    "Běží": "Running",
    "Restartuje se": "Restarting",
    "Spuštění odmítnuto": "Startup refused",
    "Zastaveno": "Stopped",
    "Stav nelze přečíst": "Status cannot be read",
    "Konfigurace Recovery byla změněna. Změna se projeví až po restartu kontejneru s Review; restartuj ho, až budou Review i Recovery nečinné.": "The Recovery configuration was changed. The change takes effect after restarting the container running Review; restart it when Review and Recovery are idle.",
    "Konfigurace Recovery byla změněna a není platná. Oprav config.json před restartem, jinak se Recovery nespustí.": "The Recovery configuration was changed and is not valid. Fix config.json before restarting, otherwise Recovery will not start.",
    "Zjištěno:": "Detected:",
    "Úplný kontrolní součet originálu": "Full checksum of the original",
    "při potvrzení chyby": "at fault confirmation",
    "před přesunem do karantény": "before moving to quarantine",
    "Chybí čerstvé hlášení průběhu; obnovením ověř spojení s Recovery.": "No recent progress report; refresh to check the connection to Recovery.",
    "Recovery čte celý originál s nízkou prioritou a součet porovná s potvrzeným stavem. Rozdíl zastaví přesun do karantény.": "Recovery reads the whole original at low priority and compares the checksum with the confirmed state. A difference stops the move to quarantine.",
    "Potvrď, že node zůstane pozastavený.": "Confirm that the node stays paused.",
    "Tento node už Review neobnovuje. Obnov přehled.": "Review no longer restores this node. Refresh the overview.",
    "Nody Tdarru, které Review po akci znovu spustí": "Tdarr nodes Review will resume after the action",
    "Ponechat pozastavený": "Keep paused",
    "NODE TDARRU": "TDARR NODE",
    "Review tento node znovu nespustí a zapomene ho. Použij to jen pro node, který jsi v Tdarru pozastavil sám, například kvůli údržbě. Ostatní nody Review obnoví jako obvykle.": "Review will not resume this node and forgets it. Use this only for a node you paused yourself in Tdarr, for example for maintenance. Review resumes the other nodes as usual.",
    "Ponechat node pozastavený": "Keep the node paused",
    "Výběr zvukových stop musí být objekt.": "The audio track selection must be an object.",
    "Vyber platný způsob kontroly.": "Choose a valid review method.",
    "Verzi revize již nelze zvýšit.": "The review revision can no longer be increased.",
    "Revizi mezitím uložilo jiné okno. Načti aktuální stav.": "Another window saved the review in the meantime. Load the current state.",
    "Revize se mezitím změnila. Otevři aktuální revizi a potvrď schválení znovu.": "The review has changed in the meantime. Open the current review and confirm the approval again.",
    "Revize musí být objekt.": "The review must be an object.",
    "Při odložení napiš důvod a další krok kontroly.": "When deferring, write the reason and the next review step.",
    "Požadavek revize musí být objekt.": "The review request must be an object.",
    "Potvrzení revize musí být objekt.": "The review confirmations must be an object.",
    "Položka se během ukládání změnila. Obnov přehled.": "The item changed while saving. Refresh the overview.",
    "Odložení musí být ručně potvrzené.": "Deferral must be confirmed manually.",
    "Neplatný čas kontrolovaného úseku.": "Invalid time of the reviewed section.",
    "Neplatný krok revize.": "Invalid review step.",
    "Neplatný index zvukové stopy.": "Invalid audio track index.",
    "Neplatná verze revize.": "Invalid review revision.",
    "Neplatná identita revize.": "Invalid review identity.",
    "Nejprve ručně dokonči předchozí kontroly.": "First complete the previous checks manually.",
    "Nejprve dokonči a ulož ruční revizi obrazu, zvuku a synchronizace.": "First complete and save the manual review of picture, audio and synchronisation.",
    "Každou kontrolu potvrď ručně.": "Confirm each check manually.",
    "Přehrávač musí být text.": "The player must be text.",
    "Poznámka musí být text.": "The note must be text.",
    "Audit rozhodnutí není běžný soubor.": "The decision audit is not a regular file.",
    "Čas je mimo délku kontrolovaných souborů.": "The time is outside the duration of the reviewed files.",
    "Chybí obrazová stopa.": "The video track is missing.",
    "Tuto kombinaci HDR nelze porovnat.": "This HDR combination cannot be compared.",
    "Položku nelze bezpečně přiřadit k revizi. Obnov přehled.": "The item cannot be safely matched to the review. Refresh the overview.",
    "Soubory nejsou dostupné nebo se změnily. Obnov přehled.": "The files are unavailable or have changed. Refresh the overview.",
    "Soubory se během kontroly změnily. Obnov přehled.": "The files changed during verification. Refresh the overview.",
    "Během ukládání začala jiná akce. Zkus revizi znovu.": "Another action started while saving. Try saving the review again.",
    "Položka se během kontroly změnila. Obnov přehled.": "The item changed during verification. Refresh the overview.",
    "Nelze ověřit délku kontrolovaných souborů.": "The duration of the reviewed files cannot be verified.",
    "Ukázky": "Samples",
    "Stav ukázek": "Sample status",
    "Připraveno": "Ready",
    "Připravuje se": "Preparing",
    "Vypnuto": "Disabled",
    "Částečně": "Partial",
    "Ukázky částečně připravené": "Samples partially prepared",
    "Pár stop není jednoznačný. Vyber odpovídající stopy ručně.": "The track pair is ambiguous. Select corresponding tracks manually.",
    "Ukázky zatím nejsou připravené.": "Samples are not prepared yet.",
    "Příprava ukázek je vypnutá": "Sample preparation is disabled",
    "Ukázky nejsou dostupné": "Samples are unavailable",
    "Ukázky připravené": "Samples ready",
    "Příprava ukázek probíhá": "Preparing samples",
    "Příprava ukázek má chybu": "Sample preparation has an error",
    "Ukázky čekají na přípravu": "Samples waiting for preparation",
    "Připravené ukázky": "Prepared samples",
    "Ukázky se připravují předem. Navržený pár stop je pouze návrh; správné soubory a stopy potvrď ručně.": "Samples are prepared in advance. The proposed track pair is only a suggestion; confirm the correct files and tracks yourself.",
    "Navržený pár stop:": "Suggested track pair:",
    "Plánované úseky (sekundy):": "Planned sections (seconds):",
    "Hotové snímky jsou načtené.": "Prepared frames are loaded.",
    "Hotová ukázka se načte automaticky. Jiný úsek vytvoř tlačítkem.": "A prepared sample will load automatically. Use the button to create a different section.",
    "Pro vybraný úsek není hotová ukázka. Vytvoř ji tlačítkem.": "There is no prepared sample for this section. Use the button to create it.",
    "Hotová ukázka je načtená. Přehrávání spusť ručně.": "The prepared sample is loaded. Start playback manually.",
    "Přehrávám připravené A/B ukázky.": "Playing prepared A/B samples.",
    "Příprava ukázek": "Sample preparation",
    "Nastavit přípravu ukázek": "Configure sample preparation",
    "Limity mezipaměti a automatická příprava porovnání pro čekající filmy.": "Cache limits and automatic sample preparation for pending movies.",
    "Připravovat ukázky automaticky": "Prepare samples automatically",
    "Limit mezipaměti (MiB)": "Cache limit (MiB)",
    "Nejvýše připravovaných filmů": "Maximum movies to prepare",
    "Mezipaměť:": "Cache:",
    "Hotové položky:": "Ready entries:",
    "Ve frontě:": "Queued:",
    "Probíhá:": "Running:",
    "Uložit nastavení": "Save settings",
    "Ověřit stav všech případů": "Verify the status of all cases",
    "Tdarr už převod nehlásí jako chybný; obnov stav.": "Tdarr no longer reports the transcode as failed; refresh the status.",
    "Report převodu v Tdarru nelze přečíst; opakování Review nenabídne, dokud příčina není známá.": "The transcode report in Tdarr cannot be read; Review offers no retry until the cause is known.",
    "Převod selhal na poškozeném souboru náhrady; poškozením se zabývá Recovery ve vlastním případu. Opakování nepomůže.": "The transcode failed on a damaged replacement file; Recovery handles the damage in its own case. A retry would not help.",
    "Nejnovější úloha tohoto souboru v Tdarru není ta chybná; obnov stav.": "The newest Tdarr job of this file is not the failed one; refresh the status.",
    "Nejnovější úloha tohoto souboru v Tdarru nemá čas konce; opakování se nenabízí, obnov stav.": "The newest Tdarr job of this file has no end time; no retry is offered, refresh the status.",
    "Stav převodu nelze ověřit; obnov stav.": "The transcode state cannot be verified; refresh the status.",
    "Review už převod jednou zopakovalo; další opakování nenabízí.": "Review has already retried the transcode once; it offers no further retry.",
    "Opakovaný převod také selhal; prověř Tdarr. Diagnostiku k exportu přinese další verze.": "The retried transcode failed too; inspect Tdarr. An exportable diagnostic comes in a later version.",
    "Tdarr náhradu podle svých pravidel nepotřebuje převádět; opakování by ji znovu vynechalo.": "Tdarr's rules do not require transcoding the replacement; a retry would skip it again.",
    "Tdarr pro tuto kopii po importu nerozhodl Not required; obnov stav.": "Tdarr has not decided Not required for this copy since the import; refresh the status.",
    "Zkusit převod znovu": "Retry the transcode",
    "Tdarr soubor znovu zařadí do fronty a převede ho; v knihovně se nic nepřesouvá.": "Tdarr queues the file again and transcodes it; nothing in the library moves.",
    "Příčina selhání převodu": "Cause of the transcode failure",
    "Provozní chyba (oprávnění, disk, paměť nebo síť)": "Operational error (permissions, disk, memory or network)",
    "Příčina není rozpoznaná": "Cause not recognized",
    "Poškození při dekódování": "Decoding damage",
    "Report nelze přečíst": "The report cannot be read",
    "Hláška dekodéru:": "Decoder message:",
    "OPAKOVÁNÍ PŘEVODU": "TRANSCODE RETRY",
    "Zopakovat převod? Tdarr přesně tento soubor znovu zařadí do fronty a převede ho. Review to udělá pro tuto kopii jen jednou. V knihovně se nic nepřesouvá, karanténa zůstává zachovaná a převedený výsledek bude potřeba schválit.": "Retry the transcode? Tdarr queues exactly this file again and transcodes it. Review does this only once for this copy. Nothing in the library moves, the quarantine is kept, and the transcoded result will still need approval.",
    "Předchozí opakování nebylo potvrzeno. Potvrzením prohlašuješ, že jsi Tdarr zkontroloval a soubor v něm znovu neběží. Tdarr přesně tento soubor znovu zařadí do fronty; v knihovně se nic nepřesouvá a karanténa zůstává zachovaná.": "The previous retry was not confirmed. By confirming you state that you checked Tdarr and the file is not running there again. Tdarr queues exactly this file again; nothing in the library moves and the quarantine is kept.",
    "Zopakovat převod": "Retry the transcode",
    "Zkontroloval jsem Tdarr, zopakovat": "I checked Tdarr, retry",
    "Opakování teď není dostupné. Obnov stav.": "The retry is not available now. Refresh the status.",
    "Tato kopie nebyla převedena: Tdarr ji podle svých pravidel nepotřeboval převádět. Posuzuješ importovanou náhradu tak, jak ji stáhl Radarr.": "This copy was not transcoded: Tdarr's rules did not require it. You are assessing the imported replacement as Radarr downloaded it.",
    "Stav předání nelze ověřit; obnov stav.": "The handoff state cannot be verified; refresh the status.",
    "Pro předání Tdarru vyplň v nastavení ID knihovny Tdarr.": "To hand over to Tdarr, fill in the Tdarr library ID in the settings.",
    "Soubor náhrady v knihovně chybí.": "The replacement file is missing from the library.",
    "Soubor náhrady není běžný samostatný soubor; správce ho musí zkontrolovat.": "The replacement is not a plain single file; an administrator must inspect it.",
    "Soubor náhrady se od importu změnil; správce musí zkontrolovat, co ho změnilo.": "The replacement file has changed since the import; an administrator must check what changed it.",
    "Soubor náhrady se nedávno změnil; předání bude možné po 10 minutách klidu.": "The replacement file changed recently; the handoff is possible after 10 quiet minutes.",
    "Náhrada je v Tdarru pozastavená (Hold); Review Hold neuvolňuje, uvolni ho v Tdarru.": "The replacement is on Hold in Tdarr; Review does not release a Hold, release it in Tdarr.",
    "Náhradu drží Hold jiného případu, který ji chrání; Review ho neuvolní.": "Another case holds the replacement to protect it; Review does not release that Hold.",
    "Náhrada už do Tdarru došla; obnov stav.": "The replacement has reached Tdarr; refresh the status.",
    "Tdarr soubor právě zpracovává.": "Tdarr is processing the file right now.",
    "Probíhá jiná akce; předání bude možné po jejím dokončení.": "Another action is running; the handoff is possible once it finishes.",
    "Recovery předání vzdala; správce musí případ zkontrolovat. Schválení by tu úklid karantény nespustilo.": "Recovery gave up on the handoff; an administrator must inspect the case. An approval would not start the quarantine cleanup here.",
    "Předat náhradu Tdarru": "Hand the replacement to Tdarr",
    "Tdarr soubor znovu naskenuje a zařadí ho podle svých pravidel; v knihovně se nic nepřesouvá.": "Tdarr rescans the file and queues it by its own rules; nothing in the library moves.",
    "Náhrada se do Tdarru nedostala": "The replacement did not reach Tdarr",
    "Předej náhradu Tdarru z přehledu případu.": "Hand the replacement to Tdarr from the case overview.",
    "PŘEDÁNÍ TDARRU": "HANDOFF TO TDARR",
    "Předat náhradu Tdarru? Tdarr přesně tento soubor znovu naskenuje a zařadí ho podle svých pravidel. V knihovně se nic nepřesouvá, karanténa zůstává zachovaná a převedený výsledek bude potřeba schválit.": "Hand the replacement to Tdarr? Tdarr rescans exactly this file and queues it by its own rules. Nothing in the library moves, the quarantine is kept, and the transcoded result will still need approval.",
    "Předchozí předání nebylo potvrzeno. Potvrzením prohlašuješ, že jsi Tdarr zkontroloval a soubor v něm není. Tdarr přesně tento soubor znovu naskenuje; v knihovně se nic nepřesouvá, karanténa zůstává zachovaná a převedený výsledek bude potřeba schválit.": "The previous handoff was not confirmed. By confirming you state that you checked Tdarr and the file is not there. Tdarr rescans exactly this file; nothing in the library moves, the quarantine is kept, and the transcoded result will still need approval.",
    "Předat Tdarru": "Hand to Tdarr",
    "Zkontroloval jsem Tdarr, předat znovu": "I checked Tdarr, hand over again",
    "Předání teď není dostupné. Obnov stav.": "The handoff is not available now. Refresh the status.",
    "Posouzení nainstalované kopie": "Assessment of the installed copy",
    "Nainstalovanou kopii teď nelze posoudit. Důvod je uvedený v přehledu případu.": "The installed copy cannot be assessed now. The reason is in the case overview.",
    "Posuzuješ jen kopii, která je teď v knihovně. Plný originál k porovnání není k dispozici: zdroj náhrady už v knihovně není a vadný originál v karanténě se pro porovnání nepoužívá.": "You are assessing only the copy that is in the library now. The full original is not available for comparison: the replacement's source is no longer in the library, and the faulty original in quarantine is not used for comparison.",
    "Schválení nedokazuje, že převod je věrný originálu, jen že je kopie pro tebe přijatelná.": "Approval does not prove that the transcode is faithful to the original, only that the copy is acceptable to you.",
    "Přehraj soubor ve vlastním přehrávači. Otevření ani přehrání nic nepotvrzuje.": "Play the file in your own player. Opening or playing it confirms nothing.",
    "Zařízení, na kterém jsi film přehrál": "Device you played the film on",
    "Obraz je v pořádku": "The picture is fine",
    "Zvuk je v pořádku": "The sound is fine",
    "Synchronizace na začátku sedí": "Sync is right at the start",
    "Synchronizace uprostřed sedí": "Sync is right in the middle",
    "Synchronizace na konci sedí": "Sync is right at the end",
    "HDR se zobrazuje správně": "HDR displays correctly",
    "Poznámka (povinná)": "Note (required)",
    "Uložit posouzení": "Save the assessment",
    "Schválit aktuální kopii": "Approve the current copy",
    "Posouzení je uložené a úplné.": "The assessment is saved and complete.",
    "Uveď zařízení, potvrď všechny kontroly, napiš poznámku a posouzení ulož.": "Name the device, confirm every check, write a note and save the assessment.",
    "Načítám posouzení…": "Loading the assessment…",
    "Posouzení nelze načíst.": "The assessment cannot be loaded.",
    "SCHVÁLENÍ NAINSTALOVANÉ KOPIE": "APPROVAL OF THE INSTALLED COPY",
    "Schválit kopii, která je teď v knihovně? Posoudil jsi jen tuto kopii, bez porovnání s originálem. Schválení nedokazuje věrnost převodu, jen že je kopie pro tebe přijatelná. Recovery pak spustí běžnou lhůtu úklidu karantény.": "Approve the copy that is in the library now? You assessed only this copy, without comparing it with the original. Approval does not prove the transcode is faithful, only that the copy is acceptable to you. Recovery then starts the usual quarantine cleanup period.",
    "Posoudit nainstalovanou kopii": "Assess the installed copy",
    "Otevře posouzení kopie, která je v knihovně; nic nemění.": "Opens the assessment of the copy in the library; changes nothing.",
    "Nainstalovanou kopii nelze ověřit; obnov stav.": "The installed copy cannot be verified; refresh the status.",
    "Kopie je schválená; Recovery spustí úklid karantény při další kontrole.": "The copy is approved; Recovery starts the quarantine cleanup at its next check.",
    "V knihovně není žádná kopie k posouzení.": "There is no copy in the library to assess.",
    "V knihovně je víc možných kopií; správce musí ponechat jen jednu.": "The library holds more than one possible copy; an administrator must keep only one.",
    "Kopie v knihovně není běžný samostatný soubor; správce ji musí zkontrolovat.": "The copy in the library is not a plain single file; an administrator must inspect it.",
    "V knihovně je stále nepřevedená náhrada.": "The library still holds the untranscoded replacement.",
    "Tdarr pro tuto kopii nehlásí Transcode success.": "Tdarr does not report Transcode success for this copy.",
    "V historii Tdarru není úspěšný převod této kopie po importu náhrady.": "Tdarr's history has no successful transcode of this copy after the replacement was imported.",
    "K této kopii čeká výsledek v Review; posuď ho tam.": "A Review result waits for this copy; assess it there.",
    "Probíhá jiná akce; posouzení bude možné po jejím dokončení.": "Another action is running; the assessment is possible once it finishes.",
    "Zastaralý originál Review přes aktuální kopii nevrací.": "Review does not return the obsolete original over the current copy.",
    "Znovu načte Radarr, Tdarr a knihovnu pro případy, které vyžadují zásah. Nic nemění.": "Reads Radarr, Tdarr and the library again for the cases that need attention. Changes nothing.",
    "Výsledek v Review": "Review result",
    "Soubor je na místě": "The file is in place",
    "Soubor se od záznamu změnil": "The file changed since it was recorded",
    "Soubor chybí": "The file is missing",
    "Čeká na posouzení": "Waiting for assessment",
    "Zachovaná podle záznamu": "Retained according to the record",
    "Převod dokončen": "Transcode finished",
    "Převod skončil chybou": "Transcode failed",
    "Vynecháno jako Not required": "Skipped as Not required",
    "Pozastaveno (Hold)": "Paused (Hold)",
    "Ve frontě": "Queued",
    "Převádí se": "Transcoding",
    "Import je blokovaný": "The import is blocked",
    "Fronta hlásí chybu": "The queue reports an error",
    "Hledání selhalo": "The search failed",
    "Stahuje se": "Downloading",
    "Nic se nestahuje": "Nothing is downloading",
    "Nelze ověřit": "Cannot be verified",
    "Není doloženo": "Not documented",
    "ověřeno": "verified",
    "neověřeno": "not verified",
    "Umístění filmu zatím nelze ověřit.": "The film's location cannot be verified yet.",
    "Obnovit stav": "Refresh status",
    "Jen znovu načte údaje z Radarru, Tdarru a knihovny; nic nemění.": "Only reads Radarr, Tdarr and the library again; changes nothing.",
    "Otevřít film v Radarru": "Open the film in Radarr",
    "Otevře Radarr; nic nemění.": "Opens Radarr; changes nothing.",
    "Otevře posouzení; schválení je samostatný krok.": "Opens the assessment; approval is a separate step.",
    "Spustí vyžádání náhrady; originál zůstane zachovaný v karanténě.": "Starts a replacement request; the original stays preserved in quarantine.",
    "Přesune zachované soubory zpět do knihovny.": "Moves the preserved files back into the library.",
    "Vada originálu není potvrzená dvěma kontrolami; náhradu nelze vyžádat.": "The original's fault is not confirmed by two checks; a replacement cannot be requested.",
    "Správce musí zkontrolovat záznam případu a zachované kopie.": "An administrator must inspect the case record and the preserved copies.",
    "Kontrola originálu skončila provozní nebo nejednoznačnou chybou; prověř ji v detailu.": "The original check ended with an operational or ambiguous error; inspect it in the detail.",
    "Recovery běží v režimu Verify; změny povolí až přepnutí na Repair.": "Recovery runs in Verify; changes are allowed only after switching to Repair.",
    "Opakovaný převod Review zatím nenabízí; důvod zkontroluj v Tdarru.": "Review does not offer another transcode yet; check the reason in Tdarr.",
    "Hold v Tdarru Review neuvolňuje; zkontroluj navazující případ a důvod pozastavení.": "Review does not release the Tdarr Hold; check the follow-up case and the reason for the pause.",
    "Pokud stahování v Radarru visí, odstraň ho v Radarru.": "If the download hangs in Radarr, remove it in Radarr.",
    "Stažený soubor přiřaď správnému filmu ručním importem v Radarru.": "Assign the downloaded file to the right film with a manual import in Radarr.",
    "Důkaz pro úklid karantény nesouhlasí; karanténa zůstává zachovaná.": "The evidence for quarantine cleanup does not match; the quarantine stays preserved.",
    "Schválení nebylo v ověřeném umístění nalezeno. Karanténa zůstává zachovaná; správce musí zkontrolovat vazbu případu a schvalovací evidenci. Zde schválení neopakuj ani neměň lhůtu.": "Approval evidence was not found in the verified location. The quarantine stays preserved; an administrator must check the case binding and approval record. Do not approve again or change the deadline here.",
    "Schvalovací evidenci nelze bezpečně přečíst. Karanténa zůstává zachovaná; správce musí ověřit přístup a vazbu evidence.": "Approval evidence could not be read safely. The quarantine stays preserved; an administrator must check access and the evidence binding.",
    "Vazbu případu nelze ověřit.": "The case binding could not be verified.",
    "Schvalovací evidence nemá očekávanou strukturu. Karanténa zůstává zachovaná; správce musí zkontrolovat evidenci.": "Approval evidence has an unexpected structure. The quarantine stays preserved; an administrator must inspect the evidence.",
    "Schvalovací evidence patří jiné kopii. Karanténa zůstává zachovaná; správce musí zkontrolovat vazbu.": "Approval evidence belongs to another copy. The quarantine stays preserved; an administrator must check the binding.",
    "Čas schválení nelze ověřit. Karanténa zůstává zachovaná; správce musí zkontrolovat evidenci.": "The approval time could not be verified. The quarantine stays preserved; an administrator must inspect the evidence.",
    "Schválená kopie v knihovně chybí. Karanténa zůstává zachovaná; správce musí ověřit její umístění.": "The approved copy is missing from the library. The quarantine stays preserved; an administrator must check its location.",
    "Schválenou kopii nelze bezpečně přečíst. Karanténa zůstává zachovaná; správce musí zkontrolovat soubor.": "The approved copy could not be read safely. The quarantine stays preserved; an administrator must inspect the file.",
    "Změnila se pouze metadata schválené kopie; obsah ani schválení tím nejsou znovu ověřené. Karanténa zůstává zachovaná; správce musí ověřit kopii.": "Only the approved copy's metadata changed; this does not reverify its contents or approval. The quarantine stays preserved; an administrator must inspect the copy.",
    "Schválená kopie se změnila. Karanténa zůstává zachovaná; správce musí ověřit aktuální soubor.": "The approved copy changed. The quarantine stays preserved; an administrator must inspect the current file.",
    "Identitu schválené kopie nelze ověřit. Karanténa zůstává zachovaná; správce musí zkontrolovat evidenci.": "The approved copy's identity could not be verified. The quarantine stays preserved; an administrator must inspect the evidence.",
    "Zaznamenaná kopie v karanténě chybí. Karanténa se nemaže; správce musí ověřit stav případu.": "The recorded quarantine copy is missing. No quarantine files are deleted; an administrator must check the case.",
    "Kopie v karanténě se změnila. Karanténa zůstává zachovaná; správce musí ověřit soubor.": "A quarantine copy changed. The quarantine stays preserved; an administrator must inspect the file.",
    "Kopii v karanténě nelze bezpečně přečíst. Karanténa zůstává zachovaná; správce musí zkontrolovat umístění.": "A quarantine copy could not be read safely. The quarantine stays preserved; an administrator must inspect its location.",
    "Zaznamenanou identitu kopie v karanténě nelze ověřit. Karanténa zůstává zachovaná.": "The recorded identity of a quarantine copy could not be verified. The quarantine stays preserved.",
    "Vazbu kopie v karanténě nelze ověřit. Karanténa zůstává zachovaná; správce musí zkontrolovat cestu a záznam.": "The quarantine copy's binding could not be verified. The quarantine stays preserved; an administrator must inspect the path and record.",
    "Nastavení Recovery nelze ověřit. Karanténa zůstává zachovaná; správce musí zkontrolovat konfiguraci.": "Recovery settings could not be verified. The quarantine stays preserved; an administrator must inspect the configuration.",
    "Nastavení nebo vazba případu se změnily. Karanténa zůstává zachovaná; správce musí ověřit propojení.": "The settings or case binding changed. The quarantine stays preserved; an administrator must verify the connection.",
    "Záznam případu nelze ověřit. Karanténa zůstává zachovaná; správce musí zkontrolovat Recovery data.": "The case record could not be verified. The quarantine stays preserved; an administrator must inspect Recovery data.",
    "Záznam případu neodpovídá aktuálnímu stavu. Karanténa zůstává zachovaná; správce musí zkontrolovat vazbu.": "The case record does not match the current state. The quarantine stays preserved; an administrator must inspect the binding.",
    "Vazbu náhrady nelze ověřit. Karanténa zůstává zachovaná; správce musí zkontrolovat případ.": "The replacement binding could not be verified. The quarantine stays preserved; an administrator must inspect the case.",
    "Cestu ke schvalovací evidenci nelze ověřit. Karanténa zůstává zachovaná; správce musí zkontrolovat konfiguraci.": "The approval-evidence path could not be verified. The quarantine stays preserved; an administrator must inspect the configuration.",
    "Čtení neodhalilo příčinu chyby úklidu. Karanténa zůstává zachovaná; správce musí zkontrolovat případ a zachované kopie.": "The read did not identify the cleanup failure. The quarantine stays preserved; an administrator must inspect the case and preserved copies.",
    "Stav nelze ověřit; obnov ho, a pokud zůstane neověřený, správce zkontroluje propojení.": "The status cannot be verified; refresh it, and if it stays unverified an administrator checks the connections.",
    "Výsledek v Review k této kopii zatím není doložený.": "No Review result for this copy is documented yet.",
    "Náhradu teď nelze vyžádat; důvod je uvedený v detailu.": "A replacement cannot be requested now; the reason is in the detail.",
    "Odkaz do Radarru není k dispozici; zkontroluj připojení Radarru.": "No Radarr link is available; check the Radarr connection.",
    "Co dál": "What next",
    "Kde je film teď": "Where the film is now",
    "Co můžeš udělat": "What you can do",
    "Co brání dalšímu kroku": "What blocks the next step",
    "Recovery naposledy ověřila stav:": "Recovery last checked the status:",
    "Výsledek už v Review není. Obnov stav.": "The result is no longer in Review. Refresh the status.",
    "Pokračuje navazujícím případem": "Continues in a follow-up case",
    "Otevři navazující případ. Tento případ zůstává v historii.": "Open the follow-up case. This case stays in history.",
    "Na pozadí se připravuje vždy jedna úloha. Jiný čas nebo jiné stopy můžeš vytvořit na požádání. Hotové ukázky nic nepotvrzují a A/B poslech spouštíš ručně.": "One task is prepared in the background at a time. Create a different time or track pair on demand. Prepared samples do not confirm any checks, and A/B listening starts only when you choose it.",
    "Upřednostněné jazyky zvuku (v pořadí)": "Preferred audio languages (in order)",
    "Záložní jazyky zvuku (v pořadí)": "Fallback audio languages (in order)",
    "Kódy odděl čárkou. Prázdný seznam je povolený; nejvýše 10 jazyků.": "Separate codes with commas. Empty lists are allowed; up to 10 languages.",
    "Angličtina": "English",
    "Slovenština": "Slovak",
    "Japonština": "Japanese",
    "Pokud chybí preferovaný i záložní jazyk, nabídnout jiný společný hlavní zvuk": "If preferred and fallback languages are unavailable, suggest another common main audio track",
    "Uložený pár stop má vždy přednost. Nejednoznačný návrh musíš zkontrolovat a stopy vybrat ručně.": "The saved track pair always takes priority. Review an ambiguous suggestion and select tracks manually.",
    "Nastavení přípravy ukázek uloženo.": "Sample preparation settings saved.",
    "Zobrazení porovnání": "Comparison view",
    "Dělicí čára": "Wipe comparison",
    "Vedle sebe": "Side by side",
    "Pozice dělicí čáry": "Divider position",
    "Automatický pohyb dělicí čáry": "Automatic divider movement",
    "Dělicí čára obrazu": "Picture divider",
    "Originál vlevo, převod vpravo": "Original on the left, conversion on the right",
    "Poměr stran náhledů se liší. Oba obrazy jsou zobrazené bez ořezu a bez protažení; odpovídající detaily nemusí ležet na stejném místě. Použij také zobrazení Vedle sebe.": "The previews have different aspect ratios. Both pictures are shown without cropping or stretching; corresponding details may not occupy the same position. Also use the side-by-side view.",
    "Omezený pohyb je zapnutý. Automatický pohyb zapni jen podle vlastní potřeby.": "Reduced motion is enabled. Turn on automatic movement only if you need it.",
    "Náhled pro obraz: H.264, 8bit SDR, mono AAC, nejvýše 1920 × 1080 px. Jde o nově vytvořenou ukázku; nenahrazuje posouzení nativní kvality ani HDR/Dolby Vision na vhodném zařízení.": "Picture preview: H.264, 8-bit SDR, mono AAC, up to 1920 × 1080 px. This is a newly encoded sample; it does not replace assessing native quality or HDR/Dolby Vision on a suitable device.",
    "Náhled pro synchronizaci: H.264, 8bit SDR, mono AAC, nejvýše 960 × 540 px. Jde o nově vytvořenou ukázku; nenahrazuje posouzení nativní kvality ani HDR/Dolby Vision na vhodném zařízení.": "Synchronization preview: H.264, 8-bit SDR, mono AAC, up to 960 × 540 px. This is a newly encoded sample; it does not replace assessing native quality or HDR/Dolby Vision on a suitable device.",
    "Kvalita videonáhledu": "Video preview quality",
    "Rychlý náhled · nejvýše 960 × 540": "Fast preview · up to 960 × 540",
    "Detailnější náhled · nejvýše 1920 × 1080": "Detailed preview · up to 1920 × 1080",
    "Neplatný profil videonáhledu.": "Invalid video preview profile.",
    "Náhled překročil limit velikosti. Zvol rychlý profil nebo porovnej původní snímky v rozlišení 1 : 1.": "The preview exceeded its size limit. Select the fast profile or compare native frames at 1:1.",
    "Staženo; import je zablokovaný": "Downloaded; import is blocked",
    "Radarr importuje film": "Radarr is importing the movie",
    "Staženo; čeká na import": "Downloaded; waiting for import",
    "Stahování je pozastavené": "Download is paused",
    "Průběh stahování": "Download progress",
    "Průběh stažení souboru": "File download progress",
    "Stažení souboru": "File download",
    "Zbývající čas stažení": "Download time remaining",
    "Procenta označují pouze stažení. Import, převod a schválení jsou samostatné kroky.": "Percentages describe downloading only. Import, transcoding and approval are separate steps.",
    "Případ není jednoznačně přiřazen": "The case is not uniquely matched",
    "Soubor zůstává zachovaný; nelze určit podmínky jeho úklidu.": "The file is preserved; its cleanup conditions could not be determined.",
    "Úklid vyžaduje kontrolu": "Cleanup needs inspection",
    "Soubor je stále přítomný po evidovaném úklidu": "The file is still present after recorded cleanup",
    "Otevři obnovu a ověř evidenci; automatické mazání nelze odvodit z tohoto přehledu.": "Open the recovery case and verify its records; this overview does not authorize automatic deletion.",
    "Čeká na konec schválené lhůty": "Waiting for the approved retention deadline",
    "Lhůta uběhla; čeká na bezpečný úklid": "Retention deadline passed; waiting for safe cleanup",
    "Úklid proběhne jen při splnění kontrol identity zachovaných souborů.": "Cleanup only proceeds when the preserved file identity checks pass.",
    "Chybí doložené schválení náhrady": "Verified replacement approval is missing",
    "Nejprve je potřeba posoudit funkční náhradu. Samotný úspěšný převod nestačí k úklidu karantény.": "A working replacement needs to be reviewed first. A successful transcode alone is insufficient for quarantine cleanup.",
    "Součet velikostí souborů nemusí odpovídat fyzicky zabranému místu; některé kopie mohou být hardlinky.": "The sum of file sizes may differ from physical disk usage; some copies may be hardlinks.",
    "Termín úklidu": "Cleanup deadline",
    "Otevřít obnovu": "Open recovery case",
    "Staženo; Radarr blokuje import": "Downloaded; Radarr import is blocked",
    "Otevři frontu Radarru a přiřaď stažený soubor správnému filmu přes ruční import. Nové stahování není potřeba.": "Open the Radarr queue and assign the downloaded file to the correct movie using manual import. Another download is not needed.",
    "Změnil se pouze čas změny metadat schválené kopie. Není to potvrzené poškození filmu. Karanténa zůstává zachovaná, protože chybí nový důkaz shody obsahu; další převod ani stažení nejsou tímto hlášením vyžádány.": "Only the approved copy metadata timestamp changed. This does not confirm film corruption. Quarantine is preserved because there is no new proof of content identity; this message does not request another conversion or download.",
    "Approved replacement metadata timestamp changed; content identity is not reverified; quarantine preserved": "Only the approved replacement metadata timestamp changed. Content identity has not been reverified; quarantine is preserved.",
    "Stav Tdarru je dohledán podle přesné historické cesty náhrady. Tato vazba nepotvrzuje schválení filmu ani neopravňuje k úklidu karantény.": "The Tdarr status is matched using the exact historical replacement path. This association does not confirm approval or authorize quarantine cleanup.",
    "Obnov seznam. Pokud stav zůstane neověřený, správce musí zkontrolovat propojení Recovery a Tdarru; převod ani nové stažení nespouštěj naslepo.": "Refresh the list. If the status remains unverified, an administrator needs to check the Recovery and Tdarr integration; do not start another conversion or download blindly.",
    "POSOUZENÍ": "REVIEW",
    "Podklady": "Preparation",
    "Synchronizace": "Synchronisation",
    "Rozhodnutí": "Decision",
    "Kroky posouzení": "Review steps",
    "Podklady a metadata": "Preparation and metadata",
    "Přejít k posouzení": "Start review",
    "Načíst uložený stav": "Load saved state",
    "Načítám průběh posouzení…": "Loading review progress…",
    "Ukládám průběh posouzení…": "Saving review progress…",
    "Posouzení odloženo": "Review deferred",
    "Posouzení uloženo a dokončeno": "Review saved and completed",
    "Rozpracované změny": "Unsaved changes",
    "Průběh posouzení je uložený": "Review progress is saved",
    "Průběh posouzení se nepodařilo načíst.": "Could not load review progress.",
    "Posouzení teď nelze uložit. Obnov aktuální údaje.": "Review cannot be saved now. Refresh the current data.",
    "Soubory se změnily. Zavři detail a otevři aktuální film.": "Files changed. Close the detail and open the current movie.",
    "Načítám dostupné zvukové stopy…": "Loading available audio tracks…",
    "Vyber zvukovou stopu": "Choose an audio track",
    "Vyber stejný jazyk a verzi zvuku. Změna páru ruší potvrzení zvuku a synchronizace.": "Choose matching languages and audio versions. Changing the pair clears audio and sync confirmations.",
    "Tvoje kontrola": "Your check",
    "Nástroje v Review": "Tools in Review",
    "Vlastní přehrávač / TV": "Your player / TV",
    "Způsob posouzení": "Review method",
    "Způsob posouzení:": "Review method:",
    "Přehrávač nebo zařízení": "Player or device",
    "Například TV v obýváku · Plex": "For example living room TV · Plex",
    "Obraz, zvuk a synchronizaci potvrď podle vlastního přehrávání. Review načte pouze seznam stop.": "Confirm picture, audio and sync from your own playback. Review only loads the track list.",
    "HDR/Dolby Vision ověř na vhodném zařízení. Náhled v prohlížeči převádí HDR do SDR.": "Check HDR/Dolby Vision on a suitable device. The browser preview converts HDR to SDR.",
    "Zařízení pro kontrolu HDR/Dolby Vision": "Device used to check HDR/Dolby Vision",
    "Ověřil jsem HDR/Dolby Vision na vhodném zařízení.": "I checked HDR/Dolby Vision on a suitable device.",
    "Změnit zařízení": "Change device",
    "Ověřil jsem, že porovnávám správný originál a tento převod.": "I checked that I am comparing the correct original with this transcode.",
    "Porovnej detaily, tmavé scény, pohyb a případné HDR.": "Compare details, dark scenes, motion and HDR where applicable.",
    "Poslechni odpovídající dialogové stopy, hlasitost a případné výpadky.": "Listen to matching dialogue tracks, volume and possible dropouts.",
    "Ověř soulad řeči nebo ruchů s obrazem na začátku, uprostřed a na konci.": "Check dialogue or effects against the picture at the start, middle and end.",
    "Posouzení na zařízení:": "Reviewed on device:",
    "Použij vlastní přehrávač a porovnej obě verze. Potvrzení níže vyplň po dokončení kontroly.": "Use your own player to compare both versions. Confirm the checks below after reviewing.",
    "Statické snímky": "Still frames",
    "Video a zvuk": "Video and audio",
    "Zkontroloval jsem obraz a výsledek je pro mě přijatelný.": "I checked the picture and accept the result.",
    "Zkontroloval jsem vybraný pár zvukových stop a výsledek je pro mě přijatelný.": "I checked the selected audio pair and accept the result.",
    "Ověřil jsem synchronizaci na začátku filmu.": "I checked sync at the start of the movie.",
    "Ověřil jsem synchronizaci uprostřed filmu.": "I checked sync in the middle of the movie.",
    "Ověřil jsem synchronizaci na konci filmu.": "I checked sync at the end of the movie.",
    "Uložit kontrolu začátku": "Save start check",
    "Uložit kontrolu středu": "Save middle check",
    "Uložit kontrolu konce": "Save end check",
    "Vyber úsek, potvrď odpovídající kontrolu a ulož ji. Pak pokračuj.": "Choose a clip, confirm the corresponding check and save it. Then continue.",
    "Kontrola zatím není uložená.": "This check is not saved yet.",
    "Uloženo bez času kontrolovaného úseku.": "Saved without a clip timestamp.",
    "Uloženo v čase:": "Saved at timestamp:",
    "Všechny kontroly jsou potvrzené a uložené. Můžeš rozhodnout o výsledku.": "All checks are confirmed and saved. You can decide on the result.",
    "Nejprve ulož dokončené posouzení.": "Save the completed review first.",
    "Potvrzeno": "Confirmed",
    "Poznámka k posouzení": "Review note",
    "Co jsi zjistil nebo co zbývá ověřit?": "What did you find or what remains to check?",
    "Uložit a pokračovat": "Save and continue",
    "Uložit poznámku": "Save note",
    "Uložit rozpracované posouzení": "Save draft review",
    "Odložit posouzení": "Defer review",
    "Zamítnout převod": "Reject transcode",
    "Přehrání ukázky ani graf nepotvrzuje kvalitu. Kontroly potvrzuješ a ukládáš výslovně. Pro odložení je potřeba poznámka.": "Playback and graphs do not confirm quality. You explicitly confirm and save checks. Deferral requires a note.",
    "Uložené posouzení se změnilo v jiné relaci. Načti aktuální stav před dalším uložením.": "The saved review changed in another session. Load the current state before saving again.",
    "Posouzení se od otevření potvrzení změnilo. Znovu ověř uložené kontroly.": "The review changed after opening confirmation. Check the saved review again.",
    "Posouzení vybraných filmů se změnilo. Znovu ověř uložené kontroly.": "The selected movie reviews changed. Check the saved reviews again.",
    "Vyber způsob posouzení a odpovídající zvukové stopy. Pokračuj po vlastní kontrole obou souborů.": "Choose a review method and matching audio tracks. Continue after checking both files yourself.",
    "Porovnat video a zvuk": "Compare video and audio",
    "Přehrát / pozastavit": "Play / pause",
    "Předchozí snímek": "Previous frame",
    "Další snímek": "Next frame",
    "Zvuk originálu": "Original audio",
    "Zvuk převodu": "Transcoded audio",
    "Bez zvuku": "Muted",
    "Přehrávaný zvuk": "Playing audio",
    "Společná časová osa": "Shared timeline",
    "Přehrávače byly znovu synchronizovány. Při posuzování drobného posunu použij krokování.": "Players were resynchronised. Use frame stepping to inspect small offsets.",
    "Přehrávání společného úseku.": "Playing the shared clip.",
    "Náhled nelze přehrát v tomto prohlížeči.": "This browser cannot play the preview.",
    "Náhled se načítá. Pokračuj tlačítkem Přehrát / pozastavit.": "Preview is buffering. Resume with Play / pause.",
    "Posun mezi zvukovými stopami (ms):": "Offset between audio tracks (ms):",
    "Posun zvuku nelze spolehlivě určit.": "Audio offset cannot be determined reliably.",
    "Náhled: H.264, mono AAC, nejvýše 960 px. HDR se převádí do SDR. Ukázka slouží k synchronizaci, nikoli k posouzení HDR nebo prostorového zvuku.": "Preview: H.264, mono AAC, up to 960 px. HDR is converted to SDR. Use this clip for synchronisation, not HDR or surround sound quality.",
    "Společný čas není důkaz správné synchronizace. Posuzuj pohyb úst nebo ruch proti obrazu. Krokování vychází z průměrné snímkové frekvence originálu; u proměnlivé frekvence je přibližné.": "A shared timestamp does not prove correct sync. Compare lip movement or sound effects against the picture. Frame stepping uses the original average frame rate and is approximate for variable frame rates.",
    "Připravuji dvě videa a zvukové průběhy. Příprava může trvat až čtyři minuty.": "Preparing two videos and waveforms. This can take up to four minutes.",
    "Video i zvuk jsou připravené. Vybrané stopy a čas jsou pevné pro tuto ukázku.": "Video and audio are ready. Selected tracks and time are fixed for this clip.",
    "Tento barevný profil zatím nelze bezpečně zobrazit v náhledu.": "This colour profile cannot yet be safely displayed in a preview.",
    "Obrazové profily náhledu se neshodují.": "Preview colour profiles do not match.",
    "Příprava náhledu překročila 90 sekund.": "Preview preparation exceeded 90 seconds.",
    "Náhled překročil limit velikosti.": "Preview exceeded the size limit.",
    "Neplatné parametry náhledu.": "Invalid preview parameters.",
    "Nedoloženo": "Not confirmed",
    "Čas není doložen": "Time not confirmed",
    "méně než minuta": "less than a minute",
    "Porovnání nyní není dostupné. Obnov údaje a ověř stav filmu.": "Comparison is currently unavailable. Refresh the data and check the movie's status.",
    "Nastavení nyní nelze měnit. Ověř přihlášení, aktuální údaje a probíhající operace.": "Settings cannot be changed right now. Check your sign-in, current data and active operations.",
    "Server nevrátil platnou odpověď. Obnov údaje a ověř výsledek akce.": "The server did not return a valid response. Refresh the data and verify the operation's outcome.",
    "Přihlášení vypršelo. Poslední načtené údaje nejsou aktuální.": "Your session has expired. The last loaded data is no longer current.",
    "Požadavek selhal.": "The request failed.",
    "Soubory nebo položka se změnily. Zavři detail, obnov údaje a posuď aktuální výsledek.": "The files or item have changed. Close the details, refresh the data and review the current output.",
    "Tato akce nyní není dostupná. Obnov údaje.": "This action is currently unavailable. Refresh the data.",
    "Odstraní se pouze překódovaný soubor z review. Originál v knihovně médií zůstane zachovaný.": "Only the transcoded file in Review will be deleted. The original in your media library will be preserved.",
    "SCHVÁLENÍ VÝSLEDKU": "APPROVE OUTPUT",
    "ZAMÍTNUTÍ VÝSLEDKU": "REJECT OUTPUT",
    "Přijmout rozdíl a nahradit originál": "Accept the difference and replace the original",
    "Schválit a nahradit": "Approve and replace",
    "Zamítnout a odstranit": "Reject and delete",
    "NÁHRADA PŘES RADARR": "REPLACEMENT VIA RADARR",
    "Originál i tento převod se zachovají v karanténě a dočasně zmizí z knihovny. Radarr dostane vlastní profil se stejnou nebo vyšší kvalitou a zákazem původního vydání. České + anglické audio se upřednostní, pokud jsou jazyky ve vydání správně označené; dostupnost obou není zaručená. Po importu novou kopii zpracuje Tdarr. Uveď vlastní důvod; jde o tvé rozhodnutí, nikoli automatický důkaz poškození originálu.": "The original and this transcode will be preserved in quarantine and temporarily removed from the library. Radarr will receive a dedicated profile with the same or higher quality and a block on the original release. Czech and English audio will be preferred when the release languages are correctly labelled; availability of both is not guaranteed. Tdarr will process the new copy after import. Give your own reason; this is your decision, not automatic evidence that the original is damaged.",
    "Zachovat v karanténě a hledat náhradu": "Preserve in quarantine and search for a replacement",
    "Obnovení není dostupné.": "Restoration is unavailable.",
    "OBNOVENÍ Z KARANTÉNY": "RESTORE FROM QUARANTINE",
    "Vrátit originál i převod z karantény? Radarr nesmí mít aktivní stažení ani novou importovanou kopii. Server znovu ověří identitu souborů a stav Radarru.": "Restore the original and transcode from quarantine? Radarr must have no active download or newly imported copy. The server will recheck file identity and Radarr's status.",
    "Vrátit zachované kopie": "Restore preserved copies",
    "Uveď důvod rozhodnutí.": "Give a reason for your decision.",
    "Počkej na výsledek předchozího požadavku.": "Wait for the previous request's outcome.",
    "Stav obnovy se změnil. Obnov údaje.": "The restore state has changed. Refresh the details.",
    "Výběr zapnutý": "Selection enabled",
    "Vybrat více": "Select",
    "HROMADNÉ SCHVÁLENÍ": "BATCH APPROVAL",
    "Vybrat ": "Select ",
    "K posouzení": "Ready to review",
    "Zvláštní kontrola": "Extra checks",
    "Ukázku videa se zvukem nyní nejde připravit. Film můžeš posoudit ve vlastním přehrávači; potvrzené kontroly se tím zruší a poznámka zůstane.": "The video and audio sample cannot be prepared now. You can review the film in your own player; this clears the confirmed checks and keeps the note.",
    "Posoudit ve vlastním přehrávači": "Review in your own player",
    "Zvuk vybrané stopy nešlo po přetočení připravit ani s dřívějším začátkem dekódování (30 a 60 s).": "The selected audio track could not be prepared after seeking, even when decoding started earlier (30 and 60 s).",
    "Zvuk vybrané stopy nešlo po přetočení připravit v časovém limitu 180 sekund.": "The selected audio track could not be prepared after seeking within the 180-second limit.",
    "Příprava náhledu překročila společný časový limit 180 sekund pro originál a výsledek.": "Preparing the preview exceeded the shared 180-second limit for the original and the result.",
    "Obnovený náhled nezačíná u požadovaného času.": "The recovered preview does not start at the requested time.",
    "Vyžádat jinou kopii přes Radarr": "Request another copy through Radarr",
    "Vyžádat jinou kopii": "Request another copy",
    "Náhrada není dostupná.": "Replacement is not available.",
    "Stav případu se změnil. Obnov údaje.": "The case changed. Refresh the data.",
    " Jinou kopii můžeš výslovně vyžádat přes Radarr na kartě Obnova.": " You can explicitly request another copy through Radarr on the Recovery tab.",
    "Vada originálu je potvrzená dvěma kontrolami Recovery, ale historii vydání v Radarru nelze spojit. Originál se zachová v karanténě a dočasně zmizí z knihovny; v Tdarru dostane Hold. Radarr dostane vlastní profil se stejnou nebo vyšší kvalitou a zákaz přesně tohoto vydání; jiné vydání se neblokuje a ID stažení se nedoplňuje. České + anglické audio se upřednostní, pokud jsou jazyky ve vydání správně označené. Novou kopii zpracuje Tdarr a před nahrazením ji musíš schválit v Review. Uveď vlastní důvod.": "Two Recovery checks confirmed the original is faulty, but its release history in Radarr cannot be bound. The original is kept in quarantine and temporarily leaves the library; Tdarr gets a Hold for it. Radarr gets its own profile with the same or higher quality and an exclusion of exactly this release; no other release is blocked and no download ID is filled in. Czech + English audio is preferred when the release labels its languages correctly. Tdarr processes the new copy and you must approve it in Review before it replaces anything. Give your own reason.",
    "Film v Radarru neodpovídá případu Recovery.": "The Radarr movie does not match the Recovery case.",
    "Tento případ Recovery nenabízí ruční náhradu.": "This Recovery case does not offer a manual replacement.",
    "Originál se od potvrzení vady změnil. Ruční náhrada není dostupná, dokud ho Recovery znovu neověří.": "The original changed since its fault was confirmed. Manual replacement is unavailable until Recovery checks it again.",
    "Film čeká ve frontě na nahrazení.": "This film waits in the replacement queue.",
    "Ve frontě na nahrazení": "Waiting in the replacement queue",
    "Film už čeká ve frontě na nahrazení.": "This film already waits in the replacement queue.",
    "Tento film čeká ve frontě na nahrazení. Posoudit ho půjde až po dokončení.": "This film waits in the replacement queue. It can be reviewed once that finishes.",
    "Restart přerušil čekající nahrazení": "A restart interrupted queued replacements",
    "Tyto filmy čekaly ve frontě a po restartu se nenahradily. Pokud je chceš stále nahradit, otevři jejich posouzení a potvrď nahrazení znovu.": "These films were waiting in the queue and were not replaced after the restart. If you still want them replaced, open their review and confirm the replacement again.",
    "Vadný originál bez vazby na vydání": "Faulty original without a release binding",
    "Chybí vazba na vydání v Radarru": "Release binding in Radarr is missing",
    "Historie Radarru neobsahuje import tohoto souboru.": "Radarr's history has no import of this file.",
    "Import v historii Radarru nemá ID souboru nebo velikost odpovídající souboru.": "The import in Radarr's history has no file ID or size matching the file.",
    "Historie Radarru obsahuje k souboru více importů z různých stažení.": "Radarr's history has several imports of this file from different downloads.",
    "V historii Radarru chybí stažení (grab) původního vydání.": "Radarr's history has no grab of the original release.",
    "Stažení a import v historii Radarru se liší názvem vydání nebo ID stažení; podobný název nestačí.": "The grab and the import in Radarr's history differ in release title or download ID; a similar title is not enough.",
    "Stažení původního vydání v historii Radarru nemá indexer, velikost, protokol nebo datum vydání.": "The grab of the original release in Radarr's history has no indexer, size, protocol or publication date.",
    "Vada originálu je potvrzená dvěma kontrolami; originál zůstává beze změny v knihovně.": "The original's damage is confirmed by two checks; the original stays unchanged in the library.",
    "Film se právě nahrazuje": "This film is being replaced",
    "Tento film se právě nahrazuje nebo čeká v dávce. Posoudit ho půjde až po dokončení.": "This film is being replaced or waits in the batch. It can be reviewed once that finishes.",
    "Průběh je vidět v přehledu. Mezitím můžeš posuzovat jiné filmy.": "Progress is shown in the overview. Meanwhile you can review other films.",
    "Film se právě nahrazuje nebo čeká v dávce.": "This film is being replaced or waits in the batch.",
    "Filmy k posouzení": "Films to review",
    "Kontroly a rozhodnutí": "Checks and decision",
    "Soustředit se na obraz": "Focus on the picture",
    "Schváleno · čeká na nahrazení": "Approved · waiting for replacement",
    "Posouzení je dokončené, ale film ještě není schválený. Otevři ho a v kroku Rozhodnutí zvol Schválit.": "The review is complete, but the film is not approved yet. Open it and choose Approve in the Decision step.",
    "Film nyní nelze vybrat k hromadnému nahrazení.": "This film cannot be selected for batch replacement right now.",
    "Schválit uloží rozhodnutí bez nahrazení: oba soubory zůstanou beze změny a film počká na hromadné nahrazení schválených filmů. Schválit a nahradit spustí nahrazení hned po potvrzení.": "Approve records the decision without replacing anything: both files stay unchanged and the film waits for a batch replacement of approved films. Approve and replace starts the replacement right after confirmation.",
    "HROMADNÉ NAHRAZENÍ": "BATCH REPLACEMENT",
    "Schválit": "Approve",
    "Posouzení rozpracováno": "Review in progress",
    "Posouzení dokončeno": "Review completed",
    "Rozdíl délky · schválení jednotlivě": "Duration difference · approve individually",
    "Technicky blokováno": "Technically blocked",
    "Proč nelze vybrat?": "Why can't I select it?",
    "Otevřít posouzení": "Open review",
    "Film ještě nebyl posouzen. Otevři posouzení, dokonči všechny kroky a ulož ho.": "This film has not been reviewed yet. Open its review, complete every step and save it.",
    "Soubory se změnily od posouzení. Otevři posouzení a proveď ho znovu.": "The files changed since the review. Open the review and do it again.",
    "Posouzení není dokončené. Otevři ho, dokonči všechny kroky a ulož ho.": "The review is not complete. Open it, complete every step and save it.",
    "Posouzení je odložené. Otevři ho, vyřeš důvod odložení a dokonči ho.": "The review is deferred. Open it, resolve the reason for deferring and complete it.",
    "Rozdíl délky vyžaduje samostatný souhlas; film schval jednotlivě v jeho posouzení.": "The duration difference needs its own consent; approve this film individually in its review.",
    "Film je technicky blokovaný a nelze ho schválit. Otevři jeho detail.": "This film is technically blocked and cannot be approved. Open its detail.",
    "Film nyní nelze vybrat k hromadnému schválení.": "This film cannot be selected for batch approval right now.",
    "Příprava kopie": "Preparing the copy",
    "Zápis kopie": "Writing the copy",
    "Ověření kopie": "Verifying the copy",
    "Kopie ověřena": "Copy verified",
    "Originál přesunut do zálohy": "Original moved to backup",
    "Originál uvolněn z místa": "Original moved out of place",
    "Výsledek nainstalován": "Result installed",
    "Neznámá fáze": "Unknown phase",
    "Fáze": "Phase",
    "Záznam výměny": "Exchange record",
    "Film nelze určit": "Film cannot be identified",
    "Otevřít film": "Open film",
    "Zaznamenaná identita souboru je nečitelná; nic nebylo přesunuto.": "The recorded file identity is unreadable; nothing was moved.",
    "Záznam výměny obsahuje neplatné cesty.": "The exchange record contains invalid paths.",
    "Záznam výměny nelze přečíst ani ověřit.": "The exchange record cannot be read or verified.",
    "Originál nelze prokazatelně vrátit automaticky: záloha nebo soubory se změnily, nebo výměna pokročila za bod návratu.": "The original cannot be proven safe to restore automatically: the backup or files changed, or the exchange went past the point of return.",
    "Nedokončená výměna vyžaduje ruční kontrolu": "An unfinished exchange needs manual inspection",
    "Schválení, zamítnutí a dávky jsou zablokované, dokud záznam výměny ručně neprověříš. Review tu nic neopravuje ani nemaže; oba soubory a záznam zůstávají zachované.": "Approvals, rejections and batches stay blocked until you inspect the exchange record by hand. Review does not repair or delete anything here; both files and the record are kept.",
    "Postup kontroly: docs/OPERATIONS.md, oddíl „Unresolved exchange transaction“.": "How to inspect: docs/OPERATIONS.md, section \"Unresolved exchange transaction\".",
    "Soubory se od zařazení změnily": "The files changed since the film was queued",
    "Posouzení změněných souborů není k dispozici. Dosavadní potvrzení a rozhodnutí se na ně nevztahují.": "No review is available for the changed files. Earlier confirmations and decisions do not apply to them.",
    "Ověření zkontroluje vazbu na úlohu Tdarr, technické údaje z FFprobe a to, že se soubory během ověření nezmění. Shodu obsahu neprokazuje: po úspěchu začne nové posouzení od prvního kroku.": "Verification checks the Tdarr job binding, the FFprobe technical data and that the files do not change while it runs. It does not prove equal content: after it succeeds, a new review starts from the first step.",
    "Ověřit soubory a začít nové posouzení": "Verify the files and start a new review",
    "Změnilo se jen zařízení (například po připojení disku). Ověření porovná ostatní údaje souborů.": "Only the device changed (for example after remounting a disk). Verification compares the other file details.",
    "Tuto změnu nelze ověřit automaticky (změnila se velikost, obsah nebo umístění souboru). Oba soubory zůstávají zachované; zkontroluj je ručně podle docs/OPERATIONS.md.": "This change cannot be verified automatically (the file size, content or location changed). Both files are kept; inspect them by hand as described in docs/OPERATIONS.md.",
    "Změnil se jen čas změny metadat souboru (ctime). Shodu obsahu nelze prokázat: ověř soubory a posuď film znovu od začátku.": "Only the file's metadata change time (ctime) changed. Equal content cannot be proven: verify the files and review the film again from the start.",
    "Technické údaje nebo úloha Tdarr se od zařazení změnily; nové posouzení nelze založit.": "The technical data or the Tdarr job changed since the film was queued; a new review cannot be started.",
    "Soubor se během ověření změnil. Vyžaduje kontrolu.": "A file changed during verification. It needs checking.",
    "Další krok: porovnej obraz a zvuk.": "Next step: compare the picture and audio.",
    "Ověř technické údaje a dostupnost souborů.": "Check the technical details and file availability.",
    "Posoudit": "Review",
    "Posoudit ": "Review ",
    "Tomuto hledání neodpovídá žádný výsledek.": "No outputs match this search.",
    "Všechny výsledky jsou vyřízené. Nové se objeví automaticky po dokončení převodu.": "All outputs have been handled. New outputs appear automatically when transcoding finishes.",
    "Historie": "History",
    "Obnovy": "Recovery",
    "Recovery · Radarr · Tdarr": "Recovery · Radarr · Tdarr",
    "Náhrada přes Radarr": "Replacement via Radarr",
    "Stav starší než 12 minut": "Status older than 12 minutes",
    "Prohlédnout": "View details",
    "Prohlédnout obnovu ": "View recovery for ",
    "Probíhá": "In progress",
    "Čeká": "Waiting",
    "Vyžaduje zásah": "Needs attention",
    "Dokončeno": "Completed",
    "Stav obnov není dostupný. Poslední údaje zůstávají zobrazené: ": "Recovery status is unavailable. The last loaded data remains visible: ",
    "dosud nepotvrzeno": "not yet confirmed",
    "V tomto výběru není žádná obnova.": "There are no recovery cases in this selection.",
    "Načítám případy obnovy…": "Loading recovery cases…",
    "Akce tehdy selhala: ": "The operation failed at the time: ",
    "Důvod není doložen": "Reason not confirmed",
    "Nahrazeno · logická úspora ": "Replaced · logical savings ",
    "Žádost o náhradu předaná; kopie v karanténě": "Replacement request submitted; copies in quarantine",
    "Review kopie odstraněna": "Review copy deleted",
    "Pozdější úspěšné rozhodnutí pro stejnou položku: ": "Later successful decision for the same item: ",
    "Důvod: ": "Reason: ",
    "Technické údaje události": "Event technical details",
    "Žádné události v tomto výběru.": "No events in this selection.",
    "Poslední dávka dokončena": "Last batch completed",
    "Poslední dávka přerušena": "Last batch interrupted",
    "Akce není dostupná.": "This action is unavailable.",
    "Výsledek čeká na posouzení": "Output awaiting review",
    "Originál": "Original",
    "Výsledek": "Output",
    "Možná úspora": "Potential savings",
    "Obraz": "Picture",
    "Zvuk": "Audio",
    "Titulky": "Subtitles",
    "Technické kontroly podporují rozhodnutí. Kvalitu komprese a soulad řeči s obrazem ověř při přehrávání.": "Technical checks support your decision. Check compression quality and lip sync during playback.",
    "Přejít k porovnání": "Go to comparison",
    "Originál a výsledek ve stejném čase": "Original and output at the same time",
    "Otevři pár snímků a potom porovnej odpovídající zvukové stopy. Celý výsledek můžeš přehrát po stažení.": "Open a pair of frames, then compare the matching audio tracks. You can play the full output after downloading it.",
    "Porovnat obraz": "Compare picture",
    "Porovnat zvuk": "Compare audio",
    "Stáhnout výsledek": "Download output",
    "Review MKV pro místní přehrávač": "Review MKV for a local player",
    "Délka originálu": "Original duration",
    "Délka výsledku": "Output duration",
    "Rozdíl délky": "Duration difference",
    "Statické snímky nejsou zkouškou plynulosti a věrnost HDR posuď také na TV. Zvukové grafy ukazují hlasitost a odhad posunu; nerozhodují o kvalitě nebo synchronizaci rtů.": "Static frames do not test smooth playback; check HDR fidelity on your TV as well. Audio graphs show loudness and an estimated offset; they do not determine quality or lip sync.",
    "Když převod nevyhovuje": "When the transcode is unsuitable",
    "Zamítnutí odstraní pouze review kopii. Pokud potřebuješ jiné vydání, podej samostatnou žádost Radarru; obě kopie se nejprve zachovají v karanténě.": "Rejecting deletes only the Review copy. If you need another release, submit a separate request to Radarr; both copies will first be preserved in quarantine.",
    "Požádat Radarr o jinou kopii": "Request another copy from Radarr",
    "Prohlédnout související obnovu": "View related recovery",
    "Prohlédnout karanténu": "View quarantine",
    "Doložené kontroly": "Verified checks",
    "Doloženo": "Confirmed",
    "Odchylka": "Mismatch",
    "Neověřeno": "Not verified",
    "Identita a cesty souborů": "File identity and paths",
    "Review ID": "Review ID",
    "Úloha Tdarr": "Tdarr job",
    "Snapshot": "Snapshot",
    "Chybí": "Missing",
    "Před zápisem server znovu ověří snapshot a soubory. Health check z Tdarru se při schválení neopakuje.": "Before making changes, the server will recheck the snapshot and files. Tdarr's health check is not repeated during approval.",
    "Znovu ověřit soubory": "Recheck files",
    "Poslední potvrzený stav": "Last confirmed status",
    "Původní kopie": "Original copy",
    "Zachovaná v karanténě": "Preserved in quarantine",
    "Zůstává v Plexu; vydání vyloučeno z převodů": "Remains in Plex; release excluded from transcoding",
    "Viz aktuální protokol obnovy": "See the current recovery log",
    "Další hledání": "Next search",
    "Termín není doložen": "Time not confirmed",
    "Ověření nové kopie": "Verify the new copy",
    "Výsledek je v Review a má přesně přiřazené ID.": "The output is in Review and has an exact ID match.",
    "Posoudit výsledek v Review": "Review the output in Review",
    "Pro tento případ zatím není doložený přiřazený výsledek v Review. Dokončené stažení ani převod nejsou schválením.": "No matched output in Review is confirmed for this case yet. A completed download or transcode is not approval.",
    "Nové vydání": "New release",
    "Kvalita": "Quality",
    "Jazyky": "Languages",
    "Průběh obnovy": "Recovery progress",
    "Vrátit originál i převod z karantény": "Restore the original and transcode from quarantine",
    "Prohlédnout karanténu případu": "View this case's quarantine",
    "Technické údaje obnovy": "Recovery technical details",
    "ID případu": "Case ID",
    "Zdroj": "Source",
    "Fáze": "Phase",
    "Neznámá": "Unknown",
    "Tdarr": "Tdarr",
    "Radarr": "Radarr",
    "Stav není doložen": "Status not confirmed",
    "Důvod": "Reason",
    "Vyřazené vydání": "Excluded release",
    "Neuvedeno": "Not specified",
    "Přehled": "Overview",
    "Porovnání": "Comparison",
    "Obnova": "Recovery",
    "Technické údaje": "Technical details",
    "POSOUZENÍ VÝSLEDKU": "REVIEW OUTPUT",
    "OBNOVA FILMU": "MOVIE RECOVERY",
    "Zamítnout": "Reject",
    "Posoudit rozdíl délky": "Review duration difference",
    "Přihlášení vypršelo": "Session expired",
    "Spojení přerušeno": "Connection lost",
    "Připojeno": "Connected",
    "Čekám na aktuální údaje": "Waiting for current data",
    "Přihlas se znovu. Zobrazené údaje jsou poslední načtený stav; změny jsou zablokované.": "Sign in again. The displayed data is the last loaded state; changes are blocked.",
    "Stav tohoto filmu se změnil. Zavři detail a otevři aktuální údaje.": "This movie's status has changed. Close the details and open the current data.",
    "Akce čekají na nové posouzení aktuálního stavu.": "Actions are waiting for a new review of the current state.",
    "Zapisující akce jsou dočasně zablokované.": "Actions that make changes are temporarily blocked.",
    "Tdarr Review": "Tdarr Review",
    "Nedokončená výměna vyžaduje kontrolu. Další změny jsou zablokované; soubory nepřesouvej ručně.": "An incomplete replacement requires review. Further changes are blocked; do not move files manually.",
    "Obnova stavu nodů v Tdarru není dokončená. Změny jsou zablokované; ověř jejich pozastavení.": "Restoration of the Tdarr nodes' state is incomplete. Changes are blocked; check whether they are paused.",
    "Dokončené filmy dávky": "Completed movies in the batch",
    "Doložená logická úspora": "Confirmed logical savings",
    "Z toho přes Review": "Of which via Review",
    "Čeká na schválení": "Awaiting approval",
    "Tdarr hlásí celkem": "Total reported by Tdarr",
    "Nedostupné": "Unavailable",
    "Všechny knihovny · může zahrnovat opakované převody": "All libraries · may include repeated transcodes",
    "Jak se úspora počítá": "How savings are calculated",
    "Jde o logické zmenšení souborů. Volné místo na disku se tímto neměří a zachované kopie v karanténě dál zabírají místo.": "This is the logical reduction in file sizes. Free disk space is not measured, and preserved copies in quarantine still take up space.",
    "Poslední výpočet: ": "Last calculation: ",
    "Statistiky nelze aktualizovat; poslední údaje mohou být zastaralé. ": "Statistics cannot be updated; the last loaded data may be stale. ",
    "Přihlas se pro provedení akce.": "Sign in to perform this action.",
    "Obnov aktuální stav před další akcí.": "Refresh the current status before another action.",
    "Stav výměn nelze ověřit.": "Replacement transaction status could not be verified.",
    "Jiná akce nebo dávka právě probíhá.": "Another operation or batch is running.",
    "Nedokončená výměna vyžaduje kontrolu.": "An incomplete replacement requires review.",
    "Nejprve je nutné obnovit původní stav nodů.": "The nodes' original state must be restored first.",
    "Nejprve dokonči probíhající akci.": "Finish the active operation first.",
    "Soubory se změnily. Obnov přehled.": "The files have changed. Refresh the overview.",
    "Položka nemá ověřený aktuální otisk souborů.": "The item has no verified current file fingerprint.",
    "Ověřuje se originál": "Verifying the original",
    "Vyčkej na výsledek kontroly.": "Wait for the verification result.",
    "Kontrola originálu": "Checking the original",
    "Chyba originálu potvrzena": "Original file error confirmed",
    "Obnova připraví náhradu.": "Recovery will prepare a replacement.",
    "Připravuje se kvalita náhrady": "Preparing replacement quality settings",
    "Vyčkej na dokončení přípravy.": "Wait for preparation to finish.",
    "Pozastavuje se vadné vydání": "Pausing the faulty release",
    "Vyčkej na bezpečné zastavení.": "Wait for a safe stop.",
    "Přesun do karantény": "Moving to quarantine",
    "Vyčkej na zachování kopií.": "Wait for the copies to be preserved.",
    "Kopie je v karanténě": "Copy is in quarantine",
    "Obnova připraví hledání náhrady.": "Recovery will prepare a replacement search.",
    "Vyřazuje se vadné vydání": "Excluding the faulty release",
    "Vyčkej na dokončení vyřazení.": "Wait for exclusion to finish.",
    "Vadné vydání vyřazeno": "Faulty release excluded",
    "Spouští se hledání náhrady": "Starting the replacement search",
    "Vyčkej na výsledek hledání.": "Wait for the search result.",
    "Náhrada se předává Tdarru": "Handing the replacement to Tdarr",
    "Vyčkej na potvrzení předání.": "Wait for confirmation of the handoff.",
    "Vrací se zachovaná kopie": "Restoring the preserved copy",
    "Vyčkej na dokončení návratu.": "Wait for restoration to finish.",
    "Připravuje se stažení náhrady": "Preparing the replacement download",
    "Náhrada se předává ke stažení": "Submitting the replacement for download",
    "Vyčkej na potvrzení stažení.": "Wait for the download to be confirmed.",
    "Připravuje se náhrada": "Preparing the replacement",
    "Zachovávají se obě kopie": "Preserving both copies",
    "Vyčkej na přesun do karantény.": "Wait for the move to quarantine.",
    "Review kopie je v karanténě": "Review copy is in quarantine",
    "Vyčkej na zachování originálu.": "Wait for the original to be preserved.",
    "Obě kopie jsou v karanténě": "Both copies are in quarantine",
    "Vyčkej na hledání náhrady.": "Wait for the replacement search.",
    "Obnovuje se evidence v Radarru": "Refreshing Radarr's records",
    "Vyčkej na dokončení kontroly.": "Wait for the check to finish.",
    "Vrací se originál a převod": "Restoring the original and transcode",
    "Hledání v Radarru selhalo nebo bylo zrušené.": "The Radarr search failed or was cancelled.",
    "Fronta Radarru vyžaduje kontrolu.": "The Radarr queue needs review.",
    "Stav je starší než 12 minut; obnov aktuální údaje.": "The status is older than 12 minutes; refresh the current data.",
    "Čas posledního ověření stavu není dostupný.": "The time of the last status check is unavailable.",
    "Stav nelze ověřit": "Status could not be verified",
    "Obnov stav a zkontroluj detail případu.": "Refresh the status and check the case details.",
    "Náhrada schválena; karanténa uklizena": "Replacement approved; quarantine cleared",
    "Obnova je dokončená.": "Recovery is complete.",
    "Náhrada schválena": "Replacement approved",
    "Karanténa zůstává do termínu automatického úklidu.": "Quarantine is preserved until the scheduled automatic cleanup.",
    "Obě kopie byly vráceny": "Both copies have been restored",
    "Vrácený převod před případným schválením znovu ověř v Review.": "Recheck the restored transcode in Review before approving it.",
    "Obnova vyžaduje kontrolu": "Recovery needs review",
    "Otevři detail a ověř zachované kopie před další akcí.": "Open the details and check the preserved copies before another action.",
    "Čeká na denní limit obnov": "Waiting for the daily recovery limit",
    "Obnova pokračuje po uvolnění limitu.": "Recovery will continue when the limit allows it.",
    "Náhrada zatím nenalezena": "Replacement not found yet",
    "Film zůstává v knihovně; vadné vydání se znovu nepřevádí.": "The movie remains in the library; the faulty release will not be transcoded again.",
    "Čeká ve frontě Tdarru": "Waiting in the Tdarr queue",
    "Vyčkej na převod náhrady.": "Wait for the replacement to be transcoded.",
    "Tdarr převádí náhradu": "Tdarr is transcoding the replacement",
    "Výsledek se objeví v Review po dokončení převodu.": "The output will appear in Review when transcoding finishes.",
    "Převod dokončen; čeká na posouzení": "Transcode complete; awaiting review",
    "Ověř výsledek v Review před schválením.": "Check the output in Review before approval.",
    "Převod náhrady skončil chybou": "Replacement transcoding failed",
    "Zkontroluj detail chyby a zachované kopie.": "Check the error details and preserved copies.",
    "Tdarr náhradu vynechal": "Tdarr skipped the replacement",
    "Posuď důvod vynechání a funkčnost náhrady.": "Review why the replacement was skipped and whether it works.",
    "Náhrada předána; stav Tdarru není doložen": "Replacement handed off; Tdarr status not confirmed",
    "Obnov stav a ověř, kde se náhrada nachází.": "Refresh the status and check where the replacement is.",
    "Radarr stahuje nebo importuje náhradu": "Radarr is downloading or importing the replacement",
    "Radarr stahuje; blokovaný import není potvrzen": "Radarr is downloading; an import block is not confirmed",
    "Radarr nepotvrdil blokovaný import": "Radarr has not confirmed an import block",
    "Zkontroluj aktuální diagnózu a frontu Radarru; stav případu zůstává k vyřízení.": "Check the current diagnosis and Radarr queue; the case still needs attention.",
    "Vyčkej na import náhrady.": "Wait for the replacement to be imported.",
    "Radarr hledá náhradu": "Radarr is searching for a replacement",
    "Čeká na dostupnou náhradu": "Waiting for an available replacement",
    "Zkontroluj plán dalšího hledání v detailu.": "Check the next search schedule in the details.",
    "Hledání nebo stažení není doložené": "Search or download not confirmed",
    "Ověř stav hledání v Radarru.": "Check the search status in Radarr.",
    "Zkontroluj upozornění v detailu případu.": "Check the warnings in the case details.",
    "Obnov stav; aktuální průběh nelze spolehlivě ověřit.": "Refresh the status; current progress cannot be reliably verified.",
    "Operace skončila chybou.": "The operation failed.",
    "Čeká na měření": "Waiting for a measurement",
    "Odhad času zatím není dostupný": "Time estimate not available yet",
    "Zbývá ": "Remaining ",
    "Rychlost ": "Speed ",
    "Poslední měření dekodéru": "Last decoder measurement",
    "Poslední odezva Recovery": "Last Recovery heartbeat",
    "Další pokus obnovy": "Next recovery attempt",
    "Další pokus obnovy náhrady": "Next replacement recovery attempt",
    "Další hledání náhrady": "Next replacement search",
    "Stav náhrady ověřen": "Replacement status checked",
    "Navazující kontrola náhrady": "Follow-up replacement check",
    "Otevřít navazující případ": "Open the follow-up case",
    "Změnil se čas změny metadat náhrady. Navazující případ používá vlastní aktuální identitu a důkazy; historická schválení se nepřenášejí.": "The replacement's metadata change time has changed. The follow-up case uses its own current identity and evidence; historical approvals are not carried over.",
    "Pozastavuje se vadná náhrada": "Pausing the faulty replacement",
    "Vyčkej na potvrzení pozastavení přesného vydání.": "Wait for confirmation that the exact release has been paused.",
    "Vyčkej na potvrzení pozastavení během denního limitu.": "Wait for confirmation that the release has been paused during the daily limit.",
    "Vadná náhrada pozastavena": "Faulty replacement paused",
    "Film zůstává v Plexu. Další obnova čeká na ochranný limit; toto vydání se znovu nepřevádí.": "The movie remains in Plex. Further recovery is waiting for the protective limit; this release will not be transcoded again.",
    "Kontrola originálu bez chyby": "Original check completed without errors",
    "Celý originál se dekódoval bez chyby. Jde o dokončení diagnostiky; výsledek převodu se schvaluje zvlášť v Review.": "The entire original decoded without errors. This completes the diagnostic check; the transcode output is approved separately in Review.",
    "Kontrola originálu nepotvrdila poškození": "Original check did not confirm corruption",
    "Prověř provozní nebo nejednoznačnou chybu v detailu. Náhrada se automaticky nestahuje.": "Investigate the operational or inconclusive error in the details. A replacement will not be downloaded automatically.",
    "Chyba potvrzena; změny jsou vypnuté": "Error confirmed; changes are disabled",
    "Zkontroluj nastavení Recovery před povolením obnovy.": "Check the Recovery settings before enabling recovery.",
    "Navazující obnova vyžaduje kontrolu.": "The follow-up recovery requires review.",
    "Kontrola náhrady: ": "Replacement check: ",
    "Otevři navazující případ; dokončení diagnostiky není schválením náhrady.": "Open the follow-up case; completing diagnostics does not approve the replacement.",
    "Náhrada je pozastavená v Tdarru": "Replacement is paused in Tdarr",
    "Zkontroluj důvod pozastavení a navazující případ Recovery.": "Check why it was paused and the follow-up Recovery case.",
    "Kontroluje se dekódování původního obrazu a všech zvukových stop. Každý průchod má vlastní postup.": "Checking decoding of the original picture and all audio tracks. Each pass has its own progress.",
    "Průchod skončil; čeká se na vyhodnocení skutečného výsledku dekódování.": "The pass has ended; waiting for the actual decoding result to be evaluated.",
    "Chybí čerstvé hlášení Recovery; obnovením ověř spojení. Samo o sobě to nedokazuje chybu filmu.": "A recent Recovery report is missing; refresh to check the connection. This alone does not prove a movie file error.",
    "Recovery odpovídá, ale poloha kontroly se přes 90 sekund nezměnila. Může čekat na čtení dat; chyba filmu tím není potvrzená.": "Recovery is responding, but the check position has not changed for over 90 seconds. It may be waiting to read data; this does not confirm a movie file error.",
    "Recovery odpovídá; čeká se na další měření z dekodéru.": "Recovery is responding; waiting for the next decoder measurement.",
    "Čeká na měření · Odhad času zatím není dostupný": "Waiting for a measurement · Time estimate not available yet",
    "Vybrat více filmů": "Select multiple movies",
    "Ukončit výběr filmů": "Exit selection mode",
    "Soubory": "Files",
    "Kopírování": "Copying",
    "Kontrolní součty": "Checksums",
    "Výměna": "Replacement",
    "Dokončení": "Finishing",
    "Průběh aktuálního kroku": "Current step progress",
    "Probíhá…": "In progress…",
    " · obě kopie dohromady": " · both copies combined",
    "Odhad času: čekám na aktuální měření": "Time estimate: waiting for a current measurement",
    "Čas tohoto kroku nelze spolehlivě odhadnout": "The duration of this step cannot be estimated reliably",
    "Data byla předána disku. Čekám, až systém potvrdí jejich zápis.": "The data has been sent to disk. Waiting for the system to confirm the write.",
    "Čtu review i novou kopii a porovnávám SHA-256. Originál se zatím nemaže.": "Reading the Review file and the new copy to compare SHA-256 checksums. The original has not been deleted.",
    "Stav schvalování filmů": "Movie review status",
    "Zavřít": "Close",
    "Snímky ve stejném čase, PNG bez další ztrátové komprese. Porovnání je statické, bez zvuku.": "Frames at the same timestamp, saved as PNG without additional lossy compression. This is a still-image comparison without audio.",
    "Čas ve filmu (sekundy)": "Movie timestamp (seconds)",
    "Načíst oba snímky": "Load both frames",
    "Zvětšení 1 : 1": "View at 1:1",
    "Vyber čas a načti snímky.": "Choose a timestamp and load the frames.",
    "Přizpůsobit šířce": "Fit to width",
    " % filmu": " % of the movie",
    "Připravuji oba snímky na serveru… Obvykle několik sekund, nejvýše dvě minuty.": "Preparing both frames on the server… Usually a few seconds, up to two minutes.",
    "Překódovaný výsledek": "Transcoded result",
    " v čase ": " at ",
    "Porovnání obrazu · ": "Image comparison · ",
    "HDR převedeno shodně do SDR pro náhled. Věrnost HDR ověř na TV.": "Both HDR frames have been converted to SDR using the same preview settings. Check HDR fidelity on your TV.",
    "Plné rozlišení snímků; detaily porovnej ve zvětšení 1 : 1.": "Full-resolution frames; compare details at 1:1.",
    "Nastavení Review": "Review settings",
    "Jedna knihovna na instalaci. Cesty vlevo v Docker mapování nejsou stejné jako cesty uvnitř kontejnerů. Zde zadávej cesty dostupné uvnitř Review, u polí Tdarr cesty viditelné jeho serverem.": "One library per installation. Host paths in Docker mappings differ from paths inside containers. Enter paths accessible inside Review here; for Tdarr fields, use paths visible to the Tdarr server.",
    "Název instalace": "Installation name",
    "Například Domácí knihovna": "For example, Home library",
    "Veřejná adresa Review": "Public Review URL",
    "Úplná adresa včetně http(s) a portu. Při změně se přepne adresa této stránky.": "Full URL, including http(s) and the port. Changing it redirects this page to the new URL.",
    "Adresa API Tdarr": "Tdarr API URL",
    "Například http://tdarr:8266; musí být dostupná z kontejneru Review.": "For example, http://tdarr:8266; it must be accessible from the Review container.",
    "Originály v kontejneru Review": "Original files inside the Review container",
    "Například /media; vyžaduje čtení a zápis.": "For example, /media; read and write access is required.",
    "Výsledky v kontejneru Review": "Results inside the Review container",
    "Například /review; oddělená složka s právem zápisu.": "For example, /review; a separate directory with write access.",
    "Zdrojové cesty v Tdarru": "Source paths in Tdarr",
    "Jedna cesta na řádek. První odpovídá knihovně, další jsou případné aliasy stejného obsahu.": "One path per line. The first identifies the library; additional paths are optional aliases for the same content.",
    "Review cesta v Tdarru": "Review path in Tdarr",
    "Například /pilot-review; slouží ke kontrole běžících úloh.": "For example, /pilot-review; used to check running jobs.",
    "Podsložky Review určené k odebrání z cesty": "Review subdirectories to strip from the path",
    "Jedno jméno na řádek, například PROD-Movies. Prázdné = stejná struktura jako originály.": "One name per line, for example PROD-Movies. Leave blank when the directory structure matches the originals.",
    "ID knihovny Tdarr": "Tdarr library ID",
    "Prázdné = automaticky podle zdrojové cesty.": "Leave blank to detect the library from the source path.",
    "Databáze Tdarr v kontejneru Review": "Tdarr database inside the Review container",
    "Připoj aktuální adresář SQL včetně WAL/SHM pouze pro čtení.": "Mount the current SQL directory, including WAL/SHM files, as read-only.",
    "Program FFprobe": "FFprobe executable",
    "Absolutní cesta v kontejneru Review.": "Absolute path inside the Review container.",
    "Program FFmpeg": "FFmpeg executable",
    "Absolutní cesta; používá se pro porovnání snímků.": "Absolute path; used for frame comparisons.",
    "Otestovat": "Test",
    "Ověřit a uložit": "Validate and save",
    "Ověřuji spojení a cesty…": "Checking the connection and paths…",
    "Nastavení uloženo. ": "Settings saved. ",
    "Docker připojení složek, port a trvalý adresář /data se nastavují při instalaci kontejneru. Menu je samo nevytváří. Podporovaný profil: MKV, H.264 → HEVC 10bit, kopírované zvukové a titulkové stopy; HDR10, HDR10+, Dolby Vision 8.1 a zachování Dolby Vision 7/FEL podle kompatibilního profilu Review.": "Docker volume mappings, the port and the persistent /data directory are configured when the container is installed. This menu does not create them. Supported profile: MKV, H.264 → HEVC 10-bit, copied audio and subtitle tracks; HDR10, HDR10+, Dolby Vision 8.1 and preservation of Dolby Vision 7/FEL with a compatible Review profile.",
    "Porovnej stejný jazyk i verzi zvuku (nikoli dabing s originálem nebo komentářem). Grafy ukazují hlasitost v krocích 10 ms na stejné časové ose, nikoli kvalitu zvuku. Odhad hledá posun do ±1 sekundy. Neověřuje soulad řeči s pohybem úst.": "Compare the same language and audio version, rather than dubbed audio with the original or commentary. The plots show loudness at 10 ms intervals on the same timeline; they do not measure audio quality. The estimate looks for an offset of up to ±1 second. It does not verify lip sync.",
    " — porovnání zvuku": " — audio comparison",
    "Porovnání zvuku · ": "Audio comparison · ",
    "Stopa originálu": "Original audio track",
    "Stopa převodu": "Transcoded audio track",
    "Začátek úseku (sekundy)": "Clip start (seconds)",
    "Porovnat 12 sekund": "Compare 12 seconds",
    "Načítám seznam zvukových stop…": "Loading audio tracks…",
    "Připravuji zvukové průběhy… Nejvýše dvě minuty.": "Preparing audio plots… Up to two minutes.",
    "Zvukové průběhy originálu a převodu na společné časové ose": "Original and transcoded audio plots on a shared timeline",
    "Převod": "Transcode",
    "Přehrát A/B do sluchátek": "Play A/B through headphones",
    "Zastavit": "Stop",
    "Opakovat A/B": "Repeat A/B",
    "Společná hlasitost obou ukázek": "Shared volume for both clips",
    "Společná hlasitost": "Shared volume",
    "Sluchátka: nejprve originál vlevo, potom stejný úsek převodu vpravo. Obě stopy se převedou na mono 48 kHz. Bez samostatné normalizace hlasitosti a bez automatického posunu; použij odpovídající dialogové stopy.": "Headphones: first the original in the left channel, then the same transcoded clip in the right channel. Both tracks are converted to 48 kHz mono, without separate loudness normalization or automatic alignment. Use matching dialogue tracks.",
    "A/B dokončeno. Můžeš úsek opakovat.": "A/B playback finished. You can repeat the clip.",
    "Poslech zastaven.": "Playback stopped.",
    "Prohlížeč nepodporuje zvukové A/B.": "This browser does not support A/B audio playback.",
    "Připravuji dvě 12sekundové ukázky; nejvýše dvě minuty.": "Preparing two 12-second clips; up to two minutes.",
    "Znovu připravit a přehrát A/B": "Prepare and play A/B again",
    "Vyber odpovídající stopy a klikni na Porovnat 12 sekund.": "Choose matching tracks and click Compare 12 seconds.",
    "Radarr – náhrady filmů": "Radarr – movie replacements",
    "Adresa Radarru": "Radarr URL",
    "Cesta filmové knihovny uvnitř Radarru": "Movie library path inside Radarr",
    "Karanténa originálů v Review (mimo filmovou knihovnu)": "Original-file quarantine in Review (outside the movie library)",
    "API klíč (prázdné = zachovat uložený)": "API key (leave blank to keep the saved key)",
    "Preferovat vydání s českým i anglickým audiem": "Prefer releases with both Czech and English audio",
    "Radarr posuzuje jazyky podle označení vydání. Skutečné stopy se ověří až po stažení. Samotné zamítnutí převodu nové stahování nespouští.": "Radarr assesses languages from release labels. The actual tracks are checked only after download. Rejecting a transcode alone does not start a new download.",
    "Otestovat spojení": "Test connection",
    "Stavy filmů a žádostí najdeš v sekci Obnovy.": "Movie and request statuses are in Recovery.",
    "Nastavení Radarru": "Radarr settings",
    "Neplatný poslechový úsek.": "Invalid playback clip.",
    "Neplatný zvukový vzorek.": "Invalid audio sample.",
    "Karanténa": "Quarantine",
    "Originály se uchovávají do schválení funkční náhrady v Review.": "Originals are kept until a working replacement is approved in Review.",
    "Automatický úklid je zapnutý pro náhrady s uloženým důkazem schválení a nezměněnou identitou obou souborů.": "Automatic cleanup is enabled for replacements with saved proof of approval and unchanged identities of both files.",
    "Automatický úklid karantény je vypnutý.": "Automatic quarantine cleanup is disabled.",
    "Starší případy bez důkazu zůstávají zachované.": "Older cases without proof are retained.",
    "Pro tento výběr není v karanténě žádný soubor.": "There are no quarantined files for this selection.",
    "Kopírovat cestu": "Copy path",
    "Zkopírováno": "Copied",
    "Označ a zkopíruj cestu výše": "Select and copy the path above",
    "Zobrazit celou karanténu": "Show all quarantined files",
    "Stav aktualizován: ": "Status updated: ",
    "Stav je starší než 12 minut; spojení s Recovery může být přerušené.": "The status is more than 12 minutes old; the connection to Recovery may have been lost.",
    "Náhrada: ": "Replacement: ",
    "Původní kopie je zachovaná v karanténě.": "The original copy is retained in quarantine.",
    "Úklid karantény po schválení: ": "Quarantine cleanup after approval: ",
    " · odhad ": " · estimated ",
    "Vydání vyřazeno z převodů — náhrada zatím nenalezena": "Release excluded from transcoding — no replacement found yet",
    "Film zůstává v Plexu. Jeho původní zvuk má potvrzenou chybu; toto vydání se nebude znovu převádět.": "The movie remains in Plex. An error in its original audio has been confirmed; this release will not be transcoded again.",
    "Vyřazené vydání: ": "Excluded release: ",
    "Poslední hledání: ": "Last search: ",
    "Další automatické hledání: ": "Next automatic search: ",
    "Otevřít film v Radarru — ruční hledání": "Open movie in Radarr — manual search",
    "Můžeš nezávisle hledat jiné vydání přes interaktivní hledání v Radarru. Vybírej stejnou nebo vyšší kvalitu; vyřazené vydání znovu nestahuj. Před nahrazením ověř stav obnovy; původní kopie se uchová podle pravidel karantény.": "You can independently search for another release using interactive search in Radarr. Choose the same or higher quality and do not download the excluded release again. Check the recovery status before replacing it; the original copy is retained under the quarantine rules.",
    "Tdarr · Review": "Tdarr · Review",
    "Přejít k obsahu": "Skip to content",
    "Načítám…": "Loading…",
    "Obnovit": "Refresh",
    "Přihlášení do Review": "Sign in to Review",
    "Použij přístupový klíč pro tuto knihovnu.": "Use the access key for this library.",
    "Přístupový klíč": "Access key",
    "Přihlásit": "Sign in",
    "Hlavní sekce": "Main sections",
    "Pozornost": "Attention",
    "Úspory": "Savings",
    "Nastavení": "Settings",
    "Jazyk": "Language",
    "Průběh aktuální operace": "Current operation progress",
    "Průběh dávky": "Batch progress",
    "PRACOVNÍ PŘEHLED": "WORK OVERVIEW",
    "Co potřebuje tvoje rozhodnutí": "What needs your decision",
    "Prohlédni obraz a zvuk, pak rozhodni o nahrazení originálu.": "Review the picture and audio, then decide whether to replace the original.",
    "Najít film": "Find a movie",
    "Název filmu": "Movie title",
    "Zobrazení": "Layout",
    "Knihovna": "Library",
    "Vybrat všechny zobrazené vhodné filmy": "Select all eligible movies shown",
    "Schválit vybrané (0)": "Approve selected (0)",
    "Zrušit výběr": "Clear selection",
    "Načítám výsledky…": "Loading results…",
    "RADARR · RECOVERY · TDARR": "RADARR · RECOVERY · TDARR",
    "Obnovy filmů": "Movie recovery",
    "Stažení, převod a schválení jsou samostatné kroky. Neověřený stav zůstává viditelný.": "Downloading, transcoding and approval are separate steps. Unverified status stays visible.",
    "Obnovit seznam": "Refresh list",
    "Stav obnovy": "Recovery status",
    "Najít obnovu": "Find a recovery case",
    "UDÁLOSTI": "EVENTS",
    "Historie rozhodnutí": "Decision history",
    "Dokončená rozhodnutí a navazující upozornění. Schválený film se znovu neposílá ke schválení.": "Completed decisions and follow-up warnings. An approved movie is not sent for approval again.",
    "Najít událost": "Find an event",
    "Typ události": "Event type",
    "Všechny": "All",
    "Upozornění a chyby": "Warnings and errors",
    "Schválené": "Approved",
    "Zamítnuté": "Rejected",
    "Náhrady": "Replacements",
    "Předchozí": "Previous",
    "Další": "Next",
    "KNIHOVNA": "LIBRARY",
    "Doložené zmenšení souborů a potenciál čekající na rozhodnutí.": "Verified file size reductions and potential savings awaiting a decision.",
    "Obnovit statistiky": "Refresh statistics",
    "SPRÁVA": "ADMINISTRATION",
    "Konfigurace je oddělená od každodenního posuzování filmů.": "Configuration is separate from everyday movie review.",
    "Cesty knihovny, spojení s Tdarrem a název instalace.": "Library paths, Tdarr connection and installation name.",
    "Nastavit Review": "Configure Review",
    "Spojení, profil náhrad a jazykové preference.": "Connection, replacement profile and language preferences.",
    "Nastavit Radarr": "Configure Radarr",
    "Zachované kopie a podmínky úklidu po ověřeném schválení.": "Retained copies and cleanup conditions after verified approval.",
    "Vzhled a plakáty": "Appearance and posters",
    "Výchozí je pracovní přehled. Volba knihovny se uloží v tomto prohlížeči.": "The work overview is the default. The library layout preference is saved in this browser.",
    "Plakáty načítá server ze správně přiřazených filmů v Radarru. Při chybě spojení se použije uložený obrázek nebo náhradní symbol.": "The server loads posters from precisely matched movies in Radarr. If the connection fails, it uses a cached image or a placeholder.",
    "Používat pracovní přehled": "Use work overview",
    "Jak funguje schválení a uchování souborů": "How approval and file retention work",
    "Schválení ověří identitu souborů, zkopíruje výsledek a porovná SHA-256. Poté nahradí původní verzi. Health check z Tdarru se neopakuje. Zamítnutí odstraní pouze review kopii.": "Approval verifies file identity, copies the result and compares SHA-256 checksums. It then replaces the original version. The Tdarr health check is not repeated. Rejection deletes only the review copy.",
    "U náhrad v karanténě běží 7denní lhůta až od doloženého schválení funkční náhrady a vyžaduje nezměněnou identitu souborů. Čas stažení lhůtu nespouští.": "For quarantined replacements, the 7-day retention period starts only after verified approval of a working replacement and requires unchanged file identity. Download time does not start this period.",
    "Poslední údaje:": "Latest data:",
    "· automatická obnova Review každé 2 s": "· Review refreshes automatically every 2 s",
    "Detail filmu": "Movie details",
    "Důvod rozhodnutí": "Decision reason",
    "Co je potřeba ověřit nebo opravit?": "What needs to be checked or corrected?",
    "Důvod se uloží do historie.": "The reason will be saved in history.",
    "Zpět": "Back",
    "Potvrdit": "Confirm",
    "Tdarr vrátil neplatný seznam nodů.": "Tdarr returned an invalid node list.",
    "Tento film právě zpracovává Tdarr. Schválení počká na dokončení úlohy; zkus ho poté znovu.": "Tdarr is processing this movie. Approval must wait until the job finishes; try again afterwards.",
    "Během výměny se změnil stav nodů. Originál nebyl vyměněn.": "Node state changed during replacement. The original was not replaced.",
    "Připravuji žádost Radarru": "Preparing the Radarr request",
    "Aplikace byla restartována. Zbývající filmy nebyly automaticky schválené; vyber je znovu.": "The application restarted. The remaining movies were not automatically approved; select them again.",
    "Soubor je čerstvě vytvořený. Čekám na dokončení zápisu.": "The file was just created. Waiting for writing to finish.",
    "Soubory se od zařazení do review změnily. Vyžadují kontrolu.": "Files have changed since entering review. They require checking.",
    "Zaznamenaná identita souboru je nečitelná. Vyžaduje kontrolu.": "The recorded file identity is unreadable. It requires checking.",
    "Rozdílná délka — vyžaduje zvláštní kontrolu, automatické schválení je zablokované.": "Duration mismatch — special review required; automatic approval is blocked.",
    "Výsledek není menší než originál.": "The result is not smaller than the original.",
    "Výrazné zmenšení: porovnej detaily obrazu, zrno a tmavé scény.": "Large size reduction: compare picture detail, grain and dark scenes.",
    "Před schválením posuď obraz a zvuk při přehrávání.": "Review the picture and audio during playback before approving.",
    "Ověřuji soubory": "Verifying files",
    "Ověřuji soubory, délku a zachované stopy": "Verifying files, duration and retained tracks",
    "Je nutné dokončit obnovu předchozí výměny.": "Recovery of the previous replacement must finish first.",
    "Tento film právě zpracovává Tdarr. Zkus akci po dokončení.": "Tdarr is processing this movie. Try the action when it finishes.",
    "Odstraňuji pouze review kopii": "Deleting only the review copy",
    "Review soubor se změnil.": "The review file has changed.",
    "Rozdílnou délku nelze schválit bez zvláštní kontroly.": "A duration mismatch cannot be approved without special review.",
    "Pozastavuji přijímání nových úloh v Tdarru": "Pausing new job intake in Tdarr",
    "Kopíruji výsledek do složky filmu": "Copying the result to the movie folder",
    "Čekám na dokončení zápisu na disk": "Waiting for disk writing to finish",
    "Porovnávám kontrolní součty obou kopií": "Comparing checksums of both copies",
    "Připravuji výměnu": "Preparing replacement",
    "Nahrazuji originál": "Replacing the original",
    "Dokončuji výměnu": "Finishing replacement",
    "Odstraňuji hotovou review kopii": "Deleting the completed review copy",
    "Soubor je nahrazený": "The file has been replaced",
    "Obnovuji údaje filmu v Tdarru": "Updating movie metadata in Tdarr",
    "Uklízím prázdné složky review": "Cleaning up empty review folders",
    "Obnovuji původní stav nodů": "Restoring the original node state",
    "Dávka je zastavená kvůli nedokončené výměně nebo obnovení nodů.": "The batch stopped because replacement or node restoration is incomplete.",
    "Požadavek je příliš velký.": "The request is too large.",
    "Nepovolená adresa serveru.": "Server address not allowed.",
    "Nepovolený původ požadavku.": "Request origin not allowed.",
    "Vyžadován JSON.": "JSON required.",
    "Zkus přihlášení za minutu.": "Try signing in again in a minute.",
    "Nesprávný přístupový klíč.": "Incorrect access key.",
    "Přihlas se přístupovým klíčem.": "Sign in with the access key.",
    "Plakát není dostupný.": "Poster unavailable.",
    "Probíhá změna nastavení.": "Settings are being changed.",
    "Karanténa nesmí být symlink.": "Quarantine must not be a symbolic link.",
    "Právě probíhá jiná akce.": "Another operation is in progress.",
    "Nejprve dokonči probíhající akci nebo obnovu.": "Finish the active operation or recovery first.",
    "Položka se změnila. Obnov přehled.": "The item has changed. Refresh the overview.",
    "Potvrď obnovení zachovaných kopií.": "Confirm restoration of the retained copies.",
    "Obnovení karantény": "Quarantine restoration",
    "Nejprve dokonči probíhající akce, náhled nebo obnovu.": "Finish active operations, previews or recovery first.",
    "Nastavení se mezitím změnilo. Otevři ho znovu.": "Settings have changed. Open them again.",
    "Neplatná odpověď Tdarru.": "Invalid Tdarr response.",
    "Vyber jednoznačnou knihovnu a její zdrojovou cestu v Tdarru.": "Select an unambiguous Tdarr library and its source path.",
    "Připojení, databáze a cesty jsou dostupné.": "The connection, database and paths are accessible.",
    "Nejprve je nutné dokončit obnovu výměny nebo nodů.": "Finish replacement or node recovery first.",
    "Vyber 1 až 100 filmů.": "Select 1 to 100 movies.",
    "Stejný film je v dávce vícekrát.": "The batch contains the same movie more than once.",
    "Některý vybraný film se změnil nebo ho nelze schválit. Obnov přehled.": "A selected movie has changed or cannot be approved. Refresh the overview.",
    "Tuto změnu nelze bezpečně znovu ověřit. Obnov přehled.": "This change cannot be safely rechecked. Refresh the overview.",
    "Jiná akce právě probíhá.": "Another operation is in progress.",
    "Jiná akce nebo dávka právě probíhá. Počkej na dokončení.": "Another operation or batch is in progress. Wait for it to finish.",
    "Před další akcí je nutné dokončit obnovu výměny nebo nodů.": "Finish replacement or node recovery before another operation.",
    "Soubor nelze bezpečně přiřadit k originálu.": "The file cannot be safely matched to the original.",
    "Obnov přehled, soubory se změnily.": "Refresh the overview; the files have changed.",
    "Právě probíhá jiná akce. Zkus to za chvíli.": "Another operation is in progress. Try again shortly.",
    "Vyber úsek alespoň 12 sekund před koncem filmu.": "Choose a segment starting at least 12 seconds before the movie ends.",
    "Vyber platné zvukové stopy.": "Select valid audio tracks.",
    "Soubory se během přípravy změnily.": "Files changed during preparation.",
    "48 kHz PCM; FFmpeg mono downmix; časová osa kontejneru; žádná normalizace hlasitosti ani automatické dorovnání posunu.": "48 kHz PCM; FFmpeg mono downmix; container timeline; no loudness normalization or automatic offset correction.",
    "Čas je mimo délku filmu.": "The time is outside the movie duration.",
    "Právě probíhá jiná akce nebo příprava snímků. Zkus to za chvíli.": "Another operation or frame preparation is in progress. Try again shortly.",
    "Soubor nenalezen.": "File not found.",
    "Nenalezeno.": "Not found.",
    "Neúplná nebo neznámá pole nastavení.": "Settings contain missing or unknown fields.",
    "Vyplň název instalace.": "Enter the installation name.",
    "Vyplň alespoň jednu zdrojovou cestu Tdarru.": "Enter at least one Tdarr source path.",
    "Originály a review musí být oddělené složky.": "Originals and review must use separate folders.",
    "Složky se fyzicky překrývají.": "The folders overlap physically.",
    "Neplatná cesta souboru.": "Invalid file path.",
    "Symbolické odkazy nejsou povolené.": "Symbolic links are not allowed.",
    "Soubor je mimo povolenou složku.": "The file is outside the allowed folder.",
    "Soubor není běžný soubor nebo má více pevných odkazů.": "The file is not a regular file or has multiple hard links.",
    "Neplatné cesty v záznamu výměny.": "Invalid paths in the replacement journal.",
    "Neplatná identita souboru v záznamu výměny.": "Invalid file identity in the replacement journal.",
    "Originál je zachovaný; nedokončená výměna nebyla opakována.": "The original is retained; the incomplete replacement was not repeated.",
    "Kontrola překročila časový limit.": "The check exceeded its time limit.",
    "Příliš velký výstup kontroly.": "The check output is too large.",
    "Obrazové parametry neodpovídají schvalovanému převodu.": "Video parameters do not match the transcode being approved.",
    "Originál již má značku dokončeného HDR převodu.": "The original already carries a completed HDR transcode marker.",
    "HEVC výsledek nepochází z povoleného HDR profilu.": "The HEVC result was not produced by an allowed HDR profile.",
    "Výsledek neobsahuje zvuk.": "The result contains no audio.",
    "Nelze ověřit délku filmu.": "The movie duration cannot be verified.",
    "Zvuk nebo titulky neodpovídají originálu.": "Audio or subtitles do not match the original.",
    "Nesouhlasí počet kapitol.": "The chapter count does not match.",
    "neoznačeno": "untagged",
    "žádné": "none",
    "Nepovolená cílová cesta převodu.": "Transcode destination path not allowed.",
    "Soubor se od kontroly změnil. Obnov přehled.": "The file has changed since verification. Refresh the overview.",
    "Cílový MKV již existuje; nebude přepsán.": "The destination MKV already exists and will not be overwritten.",
    "Kontrolní součet kopie nesouhlasí.": "The copy checksum does not match.",
    "Originál nahrazen; review se změnilo a nebylo odstraněno.": "The original was replaced; the review file changed and was not deleted.",
    "Neplatný úsek nebo stopa.": "Invalid segment or track.",
    "Neúplný náhled.": "Incomplete preview.",
    "Neúplný zvukový úsek.": "Incomplete audio segment.",
    "Neplatné zvukové vzorky.": "Invalid audio samples.",
    "Příprava poslechu překročila 60 sekund.": "Listening preparation exceeded 60 seconds.",
    "Příliš dlouhý zvukový úsek.": "The audio segment is too long.",
    "Příprava snímku překročila 60 sekund. Zkus jiný čas.": "Frame preparation exceeded 60 seconds. Try another time.",
    "Snímek je příliš velký.": "The frame is too large.",
    "Příliš krátký úsek.": "The segment is too short.",
    "Odhad ze zvukové obálky; kladně = výstup má zvuk později.": "Estimate from the audio envelope; positive means the output audio is later.",
    "Ticho, odlišná stopa nebo nejednoznačný průběh — posun nelze spolehlivě určit.": "Silence, a different track or an ambiguous waveform — the offset cannot be determined reliably.",
    "Neplatné parametry zvuku.": "Invalid audio parameters.",
    "Příprava zvuku překročila 60 sekund.": "Audio preparation exceeded 60 seconds.",
    "Příliš velký zvukový úsek.": "The audio segment is too large.",
    "Statistika Tdarru není dostupná.": "Tdarr statistics are unavailable.",
    "Některý protokol Review nelze přečíst.": "A Review journal cannot be read.",
    "Přiřazení úlohy": "Job matching",
    "Úspěšná úloha odpovídá cestě a velikostem obou souborů.": "The successful job matches the path and sizes of both files.",
    "Chybí potvrzená odpovídající úloha.": "No matching job has been confirmed.",
    "Úplný health check Tdarru": "Full Tdarr health check",
    "Log potvrzuje dekódování hlavního videa a všech zvukových stop.": "The log confirms decoding of the main video and all audio tracks.",
    "Log hlásí chybu health checku.": "The log reports a health check error.",
    "Průkazný výsledek v logu není dostupný.": "Conclusive evidence is unavailable in the log.",
    "Parametry obrazu": "Video parameters",
    "Parametry zatím nejsou doložené.": "Parameters have not yet been verified.",
    "Délka": "Duration",
    "Délka zatím není ověřena.": "Duration has not yet been verified.",
    "Zvukové a titulkové stopy": "Audio and subtitle tracks",
    "Shoda stop zatím není ověřena.": "Track matching has not yet been verified.",
    "Kapitoly": "Chapters",
    "Počet kapitol zatím není ověřen.": "The chapter count has not yet been verified.",
    "Vzorky synchronizace": "Synchronization samples",
    "Alespoň jeden porovnaný úsek hlásí posun nad 20 ms. Ověř výběr stejných stop.": "At least one compared segment reports an offset above 20 ms. Check that matching tracks were selected.",
    "Stejný pár stop: vzorky u začátku, uprostřed a u konce mají posun nejvýše 20 ms. Netestuje ostatní stopy ani pohyb úst.": "For the same track pair, samples near the beginning, middle and end have an offset of at most 20 ms. This does not test other tracks or lip synchronization.",
    "Schválení blokované — vyřeš uvedený důvod": "Approval blocked — resolve the stated reason",
    "Zjištěná odchylka — vyžaduje kontrolu": "Deviation detected — review required",
    "Doložené kontroly bez zjištěné odchylky": "Verified checks with no detected deviation",
    "Body jsou vážený součet doložených kontrol, nikoli procentní pravděpodobnost bezvadnosti. Neznámé kontroly mají 0 bodů. Vizuální kvalita komprese a soulad řeči s pohybem úst vyžadují posouzení při přehrávání.": "The score is a weighted total of verified checks, not a percentage probability of being flawless. Unknown checks receive 0 points. Compression quality and lip synchronization require review during playback.",
    "Vyplň adresu Radarru, API klíč a cestu knihovny v Radarru.": "Enter the Radarr address, API key and library path in Radarr.",
    "Neplatná adresa Radarru.": "Invalid Radarr address.",
    "Karanténa musí být absolutní cesta v kontejneru Review.": "Quarantine must use an absolute path inside the Review container.",
    "Neplatná cesta originálu.": "Invalid original file path.",
    "Originál nelze jednoznačně spojit se sledovaným filmem v Radarru.": "The original cannot be unambiguously matched to a monitored movie in Radarr.",
    "Radarr nezná název původního vydání; nelze ho bezpečně zakázat.": "Radarr does not know the original release name; it cannot be safely blocked.",
    "Neplatný název vydání.": "Invalid release name.",
    "Současná kvalita není povolena v profilu. Náhradu nelze bezpečně omezit.": "The current quality is not allowed by the profile. Replacement quality cannot be safely constrained.",
    "Profil nepovoluje stejnou nebo vyšší kvalitu.": "The profile does not allow equal or higher quality.",
    "Skóre profilu nelze bezpečně doplnit bez oslabení zákazů.": "The profile score cannot be safely extended without weakening exclusions.",
    "Review: původní vydání zakázáno": "Review: original release blocked",
    "Radarr neodpovídá. Stav operace ověř před opakováním.": "Radarr is not responding. Check the operation status before retrying.",
    "Radarr vrátil neplatnou odpověď.": "Radarr returned an invalid response.",
    "Nastavení Radarru je neplatné.": "Radarr settings are invalid.",
    "Probíhá kontrola náhrad, zkus to za chvíli.": "Replacements are being checked. Try again shortly.",
    "Nejprve dokonči nebo obnov otevřené žádosti o náhradu.": "Finish or restore open replacement requests first.",
    "Cesta knihovny neodpovídá filmům Radarru.": "The library path does not match Radarr movie paths.",
    "Spojení s Radarrem a cesta knihovny ověřeny.": "The Radarr connection and library path were verified.",
    "Uveď důvod žádosti o jinou kopii (nejvýše 1000 znaků).": "Provide a reason for requesting another copy (up to 1000 characters).",
    "Karanténa originálů musí ležet mimo filmovou knihovnu.": "Original-file quarantine must be outside the movie library.",
    "Rodič karantény nesmí být symlink.": "The quarantine parent must not be a symbolic link.",
    "Karanténa musí ležet na stejném souborovém systému jako originál.": "Quarantine must be on the same filesystem as the original.",
    "Originál a karanténu připoj jedním společným Docker mountem. Přesun mezi mounty není bezpečně možný.": "Mount the original and quarantine through one shared Docker mount. Moving between mounts is not safe.",
    "Pro tento film už existuje neuzavřená žádost o náhradu.": "This movie already has an open replacement request.",
    "Radarr už má pro tento film stažení ve frontě.": "Radarr already has a queued download for this movie.",
    "Ověřuji vazbu filmu na Radarr": "Verifying the movie's Radarr match",
    "Připravuji profil náhrady a zákaz původního vydání.": "Preparing the replacement profile and exclusion of the original release.",
    "Radarr mezitím změnil originál.": "Radarr has changed the original.",
    "Chybí potvrzení vytvoření zákazu.": "Creation of the exclusion has not been confirmed.",
    "Chybí potvrzení preference CZ/EN.": "The Czech/English preference has not been confirmed.",
    "Chybí potvrzení profilu náhrady.": "The replacement profile has not been confirmed.",
    "Profil náhrady nebyl potvrzen.": "The replacement profile was not confirmed.",
    "Zachovávám originál i převod v karanténě.": "Retaining the original and transcode in quarantine.",
    "Výsledek je zachovaný v karanténě.": "The result is retained in quarantine.",
    "Originál i výsledek jsou zachované v karanténě.": "The original and result are retained in quarantine.",
    "Výsledek obnovení evidence je nejistý.": "The metadata refresh result is uncertain.",
    "Radarr nedokončil obnovu evidence.": "Radarr did not complete the metadata refresh.",
    "Radarr stále eviduje původní soubor.": "Radarr still lists the original file.",
    "Žádám Radarr o stejné nebo vyšší vydání.": "Asking Radarr for an equal or higher quality release.",
    "Výsledek hledání je nejistý.": "The search result is uncertain.",
    "Hledání bylo předáno Radarru. Originál i převod zůstávají v karanténě.": "The search was submitted to Radarr. The original and transcode remain in quarantine.",
    "Změnilo se mapování. Náhrada vyžaduje ruční kontrolu.": "Mapping has changed. The replacement requires manual review.",
    "Importovaná kopie je původní vydání nebo má neplatnou cestu.": "The imported copy is the original release or has an invalid path.",
    "Velikost importu se neshoduje.": "The imported file size does not match.",
    "Identita náhrady se po přerušeném předání změnila.": "Replacement identity changed after an interrupted handoff.",
    "Nová kopie je importovaná; čekám 10 minut na stabilní soubor.": "The new copy has been imported; waiting 10 minutes for the file to stabilize.",
    "Náhrada nemá označený norský dialog; karanténa zůstává zachovaná.": "The replacement has no tagged Norwegian dialogue track; quarantine is retained.",
    "Import se během kontroly zvuku změnil.": "The imported file changed during audio verification.",
    "Pro automatické předání vyplň ID knihovny Tdarr.": "Enter the Tdarr library ID for automatic handoff.",
    "Novou kopii už zpracovává Tdarr. Karanténa je zachovaná.": "Tdarr is already processing the new copy. Quarantine is retained.",
    "Předávám novou kopii Tdarru.": "Submitting the new copy to Tdarr.",
    "Náhrada je předaná Tdarru. Obě původní kopie zůstávají v karanténě; kvalitu náhrady ještě ověř.": "The replacement was submitted to Tdarr. Both original copies remain in quarantine; review the replacement quality.",
    "Radarr stahuje náhradu podle profilu.": "Radarr is downloading a replacement according to the profile.",
    "Hledání v Radarru selhalo nebo bylo zrušené. Obě kopie jsou zachované v karanténě.": "The Radarr search failed or was cancelled. Both copies are retained in quarantine.",
    "Hledání dokončeno; ve frontě není náhrada. Žádné vhodné vydání nemusí být dostupné.": "Search completed; no replacement is queued. A suitable release may be unavailable.",
    "Radarr hledá náhradu.": "Radarr is searching for a replacement.",
    "Tuto žádost nelze obnovit.": "This request cannot be restored.",
    "Mapování se změnilo.": "Mapping has changed.",
    "Radarr již eviduje novou kopii nebo stahování. Nejprve ho vyřeš v Radarru.": "Radarr already lists a new copy or download. Resolve it in Radarr first.",
    "Původní soubor se změnil.": "The original file has changed.",
    "Karanténa se změnila.": "Quarantine has changed.",
    "Zaznamenaná identita souboru je nečitelná; karanténa zůstává zachovaná.": "The recorded file identity is unreadable; quarantine is preserved.",
    "Cílový soubor už existuje.": "The destination file already exists.",
    "Cílová cesta se změnila.": "The destination path has changed.",
    "Obnovuji obě zachované kopie.": "Restoring both retained copies.",
    "Originál i převod byly vráceny. Před schválením znovu ověř položku Review.": "The original and transcode were restored. Recheck the Review item before approving.",
    "Uveď důvod zamítnutí.": "Provide a rejection reason.",
    "Důvod zamítnutí může mít nejvýše 1000 znaků.": "The rejection reason may contain at most 1000 characters.",
    "Důvod obsahuje nepovolené řídicí znaky.": "The reason contains disallowed control characters.",
    "Příliš velký záznam převodu.": "The transcode receipt is too large.",
    "Záznam převodu neodpovídá změně přípony.": "The transcode receipt does not match the extension change.",
    "Zdroj nebo výsledek neodpovídá záznamu převodu.": "The source or result does not match the transcode receipt.",
    "Tdarr vrátil neplatný seznam úloh.": "Tdarr returned an invalid job list.",
    "Chybí zdrojové cesty pro přiřazení úlohy.": "Source paths for job matching are missing.",
    "Neplatná relativní cesta filmu.": "Invalid relative movie path.",
    "Neplatná velikost originálu nebo výsledku.": "Invalid original or result file size.",
    "Neplatná knihovna Tdarr.": "Invalid Tdarr library.",
    "Záznam převodu neodpovídá tomuto originálu.": "The transcode receipt does not match this original.",
    "Záznam převodu má neplatné ID úlohy Tdarr.": "The transcode receipt contains an invalid Tdarr job ID.",
    "Záznam převodu nemá odpovídající úspěšnou úlohu Tdarr se stejným ID, knihovnou, cestou a velikostmi.": "The transcode receipt has no matching successful Tdarr job with the same ID, library, path and sizes.",
    "Starší výsledek odpovídá více úlohám Tdarr. Jednoznačné přiřazení vyžaduje kontrolu.": "The older result matches multiple Tdarr jobs. Unambiguous matching requires review.",
    "Chybí odpovídající úspěšná úloha Tdarr nebo se originál změnil.": "No matching successful Tdarr job was found, or the original has changed.",
    "Norská náhrada ověřena a předána do fronty Tdarru po obnovení předání, které skončilo timeoutem. Karanténa zůstává zachovaná.": "The Norwegian replacement was verified and queued in Tdarr after recovering a timed-out handoff. Quarantine is retained.",
    "Náhrada předána Tdarru": "Replacement submitted to Tdarr",
    "Náhrada čeká ve frontě Tdarru": "Replacement queued in Tdarr",
    "Potvrzená chyba originálu; obnova čeká na uvolnění denního limitu. Originál zachován.": "Confirmed original-file fault; recovery is waiting for the daily limit to clear. The original is retained.",
    "Čeká na uvolnění denního limitu obnov": "Waiting for the daily recovery limit to clear",
    "[soukromá cesta]": "[private path]",
    "Převod dokončen; ověř výsledek v Review": "Transcode completed; check the result in Review",
    "Tdarr náhradu vynechal; vyžaduje posouzení": "Tdarr skipped the replacement; review required",
    "Náhrada schválena; čeká na úklid karantény": "Replacement approved; awaiting quarantine cleanup",
    "Nelze ověřit přesnou vazbu náhrady na knihovnu Tdarr.": "The exact match between the replacement and the Tdarr library cannot be verified.",
    "Tdarr nepotvrdil přesný soubor náhrady ve správné knihovně.": "Tdarr did not confirm the exact replacement file in the correct library.",
    "Tdarr vrátil neznámý stav náhrady.": "Tdarr returned an unknown replacement status.",
    "Náhrada nenalezena; vracím vydání do knihovny a ponechávám zálohu v karanténě.": "No replacement found; restoring the release to the library and keeping a backup in quarantine.",
    "Vydání vyřazeno z převodů — náhrada zatím nenalezena. Film zůstává v knihovně; automatika hledá dál.": "Release excluded from transcoding — no replacement found yet. The movie remains in the library; automatic searching continues.",
    "Importována nová kopie; původní vydání je zachované v karanténě.": "A new copy was imported; the original release is retained in quarantine.",
    "Vydání vyřazeno z převodů — náhrada zatím nenalezena. Film zůstává v knihovně; další automatické hledání za 6 hodin.": "Release excluded from transcoding — no replacement found yet. The movie remains in the library; the next automatic search is in 6 hours.",
    "Nalezena vhodná náhrada; originál zůstává v karanténě.": "A suitable replacement was found; the original remains in quarantine.",
    "Předávám vhodnou náhradu ke stažení.": "Submitting a suitable replacement for download.",
    "Radarr stahuje jinou kopii; původní vydání zůstává v karanténě.": "Radarr is downloading another copy; the original release remains in quarantine.",
    "Nastavuje se kvalita náhrady": "Configuring replacement quality",
    "Přesun originálu do karantény": "Moving the original to quarantine",
    "Originál uložen v karanténě": "Original retained in quarantine",
    "Náhrada zatím nenalezena; film zůstává v knihovně": "No replacement found yet; the movie remains in the library",
    "Hledání nebo stahování náhrady": "Searching for or downloading a replacement",
    "Nová kopie se předává Tdarru": "Submitting the new copy to Tdarr",
    "Vrací se zachovaná kopie do knihovny": "Restoring the retained copy to the library",
    "Předává se náhrada ke stažení": "Submitting the replacement for download",
    "Pozastavuje se vadné vydání během denního limitu": "Pausing the faulty release while the daily limit applies",
    "Pozastavuje se potvrzené vadné vydání": "Pausing the confirmed faulty release",
    "Vadné vydání pozastavené; čeká na limit obnov": "Faulty release paused; waiting for the recovery limit",
    "Kontrola originálu dokončena": "Original file check completed",
    "Chyba potvrzena; automatické změny vypnuté": "Fault confirmed; automatic changes disabled",
    "Náhrada je pozastavená v Tdarru; zkontroluj důvod": "The replacement is on hold in Tdarr; check the reason",
    "Úplná kontrola originálu bez chyby": "Full original file check found no errors",
    "Schválit 1 filmů?": "Approve 1 movie?",
    "Schválit 1 filmů": "Approve 1 movie",
    "1 upozornění v historii": "1 warning in history",
    "1 obnov k ověření": "1 recovery to check",
    "Soubory ukázky nejsou dostupné nebo se změnily. Obnov přehled.": "The sample files are unavailable or have changed. Refresh the list.",
    "Nastavení náhledu se změnilo. Obnov přehled.": "Preview settings changed. Refresh the list.",
    "Soubory ukázky se změnily. Obnov přehled.": "The sample files changed. Refresh the list.",
    "Ukázky nyní nelze předpřipravit. Ověř dostupnost souborů.": "Samples cannot be prepared now. Check file availability.",
    "Příprava čeká na místo v mezipaměti. Zvyš její limit nebo použij vytvoření ukázky na požádání.": "Preparation is waiting for cache space. Increase the limit or generate the sample on demand.",
    "Některé ukázky se nepodařilo předpřipravit. Zkus je vytvořit ručně nebo použij vlastní přehrávač.": "Some samples could not be prepared. Try generating them manually or use your own player.",
    "Nastavení přípravy ukázek je uložené.": "Sample preparation settings saved.",
    "Neplatný požadavek cache.": "Invalid cache request.",
    "Neplatný typ ukázky.": "Invalid sample type.",
    "Neplatná pole nastavení ukázek.": "Invalid sample settings fields.",
    "Přípravu a záložní výběr zapni nebo vypni.": "Enable or disable preparation and the fallback selection.",
    "Neplatný seznam jazyků. Použij známé jazykové kódy.": "Invalid language list. Use known language codes.",
    "Nelze ověřit platnou délku obou souborů.": "The duration of both files could not be verified.",
    "Film nemá celý 12sekundový zvukový nebo video úsek.": "The film does not contain a full 12-second audio or video segment.",
    "Nelze jednoznačně navrhnout hlavní pár v požadovaných jazycích. Vyber ho ručně.": "A main track pair in the requested languages cannot be identified reliably. Select it manually.",
    "Uchování ukázek od vytvoření (dny)": "Sample retention from creation (days)",
    "Adresa Sonarru pro ruční kontrolu": "Sonarr URL for manual inspection",
    "API klíč Sonarru (prázdné = zachovat)": "Sonarr API key (leave blank to keep)",
    "Ruční kontrola Sonarru": "Manual Sonarr inspection",
    "Zdroj a odpovědi Sonarru jsou neověřené. Výsledek popisuje pouze metadata; nepotvrzuje existenci souboru ani povolení ke zpracování.": "The Sonarr source and responses are unverified. Results describe metadata only; they do not confirm a file exists or authorize processing.",
    "Načtení vyžaduje uložený návrh a ruční akci.": "Loading requires a saved draft and a manual action.",
    "Vybraná série": "Selected series",
    "Série": "Series",
    "Načíst série": "Load series",
    "Načítám série z uloženého Sonarru…": "Loading series from the saved Sonarr connection…",
    "Série načteny ručním požadavkem.": "Series loaded by a manual request.",
    "Zkontrolovat vybranou sérii": "Inspect selected series",
    "Načítám úplný snímek vybrané série…": "Loading the complete selected-series snapshot…",
    "Metadata načtena. Zdroj a identita souborů zůstávají neověřené.": "Metadata loaded. The source and file identity remain unverified.",
    "Snapshot: complete · Source: UNVERIFIED Sonarr metadata": "Snapshot: complete · Source: UNVERIFIED Sonarr metadata",
    "No exact linked episode metadata was returned.": "No exact linked episode metadata was returned.",
    "Číslování neuvedeno": "Numbering not supplied",
    "Uložený návrh se změnil. Načti nastavení znovu.": "The saved draft changed. Reload settings.",
    "Odpověď Sonarru překročila bezpečný limit; snímek není úplný.": "The Sonarr response exceeded the safe limit; the snapshot is incomplete.",
    "Přihlášení vyžadováno.": "Login required.",
    "Sonarr není dostupný nebo vrátil neplatná metadata. Zkontroluj uložené připojení.": "Sonarr is unavailable or returned invalid metadata. Check the saved connection.",
    "Úplný snímek · Zdroj: NEOVĚŘENÁ metadata Sonarru": "Complete snapshot · Source: UNVERIFIED Sonarr metadata",
    "Absolutní číslo": "Absolute episode number",
    "Scénové absolutní číslo": "Scene absolute episode number",
    "Scénové číslování není ověřené": "Scene numbering is unverified",
    "Datum vysílání": "Air date",
    "ID epizody": "Episode ID",
    "Scénové číslování": "Scene numbering",
    "Datum vysílání UTC": "UTC air date",
    "Scénové číslování je označené jako ověřené": "Scene numbering is marked as verified",
    "Ověření scénového číslování není uvedeno": "Scene numbering verification is not supplied",
    "souborů epizod": "episode files",
    "Soubor epizody": "Episode file",
    "ID souboru epizody": "Episode file ID",
    "Sezóna": "Season",
    "Stav vazby": "Binding status",
    "Nebyly vráceny přesné vazby epizod.": "No exact linked episode metadata was returned.",
    "Epizody bez souboru v Sonarru": "Episodes without a file in Sonarr",
    "Přesně přiřazeno": "Exactly mapped",
    "Vazba nenalezena": "No exact binding",
    "Nejednoznačná vazba": "Ambiguous binding",
    "Neplatná metadata": "Invalid metadata",
    "Neznámý stav vazby": "Unknown binding status",
    "Zkontrolovat cestu zdroje": "Check source path",
    "Kontrola odvozené cesty běží v odděleném procesu…": "Checking the derived path in an isolated process…",
    "Metadata jednoho běžného souboru jsou dostupná; obsah a identita nejsou ověřené.": "Metadata for one regular file are available; its contents and identity are unverified.",
    "Soubor na odvozené cestě nebyl nalezen.": "No file was found at the derived path.",
    "Soubor nebo cesta nesplňuje bezpečnostní omezení.": "The file or path does not meet the safety requirements.",
    "Typ souboru není podporován pro tuto kontrolu.": "This file type is not supported for this check.",
    "Cesta se během kontroly změnila.": "The path changed during the check.",
    "Kontrola zdroje už probíhá.": "A source check is already running.",
    "Kontrola zdroje není dostupná.": "The source check is unavailable.",
    "Cestu Sonarru nelze přesně namapovat.": "The Sonarr path cannot be mapped exactly.",
    "Vazba epizody není jednoznačná.": "The episode binding is ambiguous.",
    "Metadata Sonarru nejsou platná.": "The Sonarr metadata is invalid.",
    "Relativní cesta": "Relative path",
    "Velikost": "Size"
  },
  "patterns": [
    ["Originál: {0} Posuď film ve vlastním přehrávači.", "Original: {0} Review the film in your own player."],
    ["Výsledek Review: {0} Posuď film ve vlastním přehrávači.", "Review result: {0} Review the film in your own player."],
    ["Výběr slouží k hromadnému nahrazení schválených filmů. Lze vybrat: {0} z {1}.", "Selection is for batch replacement of approved films. Selectable: {0} of {1}."],
    ["Nahradit vybrané schválené filmy ({0})", "Replace selected approved films ({0})"],
    ["Nahradit {0} schválených filmů?", "Replace {0} approved films?"],
    ["Nahradit {0} filmů", "Replace {0} films"],
    ["Výběr slouží k hromadnému schválení dokončených posouzení. Lze vybrat: {0} z {1}.", "Selection is for batch approval of completed reviews. Selectable: {0} of {1}."],
    ["Nedokončené výměny vyžadují ruční kontrolu ({0})", "Unfinished exchanges need manual inspection ({0})"],
    ["Otevřít film {0}", "Open film {0}", {"raw": [0]}],
    ["Pozastaveno pro {0}", "Paused for {0}", {"raw": [0]}],
    ["Ponechat pozastavený: {0}", "Keep paused: {0}", {"raw": [0]}],
    ["Neplatný limit přípravy: {0}", "Invalid preparation limit: {0}", {"raw": [0]}],
    [
      "Originál nemá právě jednu video stopu. Počet video stop: {0}",
      "The original does not have exactly one video track. Video tracks: {0}"
    ],
    [
      "Výsledek nemá právě jednu video stopu. Počet video stop: {0}",
      "The result does not have exactly one video track. Video tracks: {0}"
    ],
    [
      "Kodek originálu není podporovaný (povolené jsou h264, hevc, vc1 a mpeg2video): {0}",
      "The original's codec is not supported (allowed: h264, hevc, vc1 and mpeg2video): {0}",
      {
        "raw": [0]
      }
    ],
    [
      "Výsledek není HEVC: {0}",
      "The result is not HEVC: {0}",
      {
        "raw": [0]
      }
    ],
    [
      "Výsledek nemá 10bitový formát pixelů yuv420p10le: {0}",
      "The result does not use the 10-bit pixel format yuv420p10le: {0}",
      {
        "raw": [0]
      }
    ],
    [
      "Rozlišení výsledku se liší od originálu (výsledek / originál): {0}",
      "The result's resolution differs from the original (result / original): {0}",
      {
        "raw": [0]
      }
    ],
    [
      "Stavy filmů a žádostí najdeš v sekci Obnovy. Retence karantény běží {0} dní od doloženého schválení funkční náhrady.",
      "Movie and request statuses are in Recovery. Quarantine retention lasts {0} days after documented approval of a working replacement."
    ],
    [
      "Schválená lhůta pro následný úklid je {0} dní.",
      "The approved retention period before cleanup is {0} days."
    ],
    [
      "Po ověření identity souborů a kontrolního součtu kopie se původní film ({0}) nahradí výsledkem ({1}). Původní verze bude odstraněna. Plex bude používat nový soubor. Health check z Tdarru se neopakuje. Akce může trvat několik minut. Výslovně přijímáš rozdíl délky: originál {2} s, výstup {3} s, rozdíl {4} s. Potvrď pouze po kontrole začátku, konce a synchronizace zvuku.",
      "After file identity and the copy's checksum are verified, the original movie ({0}) will be replaced with the output ({1}). The original version will be deleted. Plex will use the new file. Tdarr's health check is not repeated. The operation may take several minutes. You explicitly accept the duration difference: original {2} s, output {3} s, difference {4} s. Confirm only after checking the beginning, end and audio synchronisation."
    ],
    [
      "Vybrané filmy: {0}. Postupně se ověří identita souborů a kontrolní součet kopie, pak se nahradí originály. Původní verze budou odstraněny. Health check z Tdarru se neopakuje. Možná úspora {1}. Dávka běží na serveru i po zavření stránky. Při chybě jednoho filmu zachová jeho soubory a pokračuje dalším.",
      "Selected movies: {0}. File identity and the copy's checksum will be verified for each movie, then the originals will be replaced. The original versions will be deleted. Tdarr's health check is not repeated. Potential savings: {1}. The batch runs on the server even after you close this page. If one movie fails, its files are preserved and the batch continues with the next movie.",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Po ověření identity souborů a kontrolního součtu kopie se původní film ({0}) nahradí výsledkem ({1}). Původní verze bude odstraněna. Plex bude používat nový soubor. Health check z Tdarru se neopakuje. Akce může trvat několik minut.",
      "After file identity and the copy's checksum are verified, the original movie ({0}) will be replaced with the output ({1}). The original version will be deleted. Plex will use the new file. Tdarr's health check is not repeated. The operation may take several minutes."
    ],
    [
      "Porovnání aktuální velikosti souborů s dostupnou historií převodů a dokončenými protokoly Review. Každý soubor se počítá jednou. {0} souborů nebylo možné potvrdit; smazaná historie Tdarru může v součtu chybět.",
      "Comparison of current file sizes with available transcode history and completed Review records. Each file is counted once. {0} files could not be confirmed; deleted Tdarr history may be missing from the total."
    ],
    [
      "Odhad posunu: {0}{1} ms (krok 10 ms). Kladný posun = zvuk převodu je později. Shoda obálek: {2} %. Platí jen pro tento úsek; porovnej také začátek a konec filmu.",
      "Estimated offset: {0}{1} ms (10 ms steps). A positive offset means the transcoded audio is later. Envelope correlation: {2} %. This applies only to this clip; also compare the start and end of the movie."
    ],
    [
      " Výslovně přijímáš rozdíl délky: originál {0} s, výstup {1} s, rozdíl {2} s. Potvrď pouze po kontrole začátku, konce a synchronizace zvuku.",
      " You explicitly accept the duration difference: original {0} s, output {1} s, difference {2} s. Confirm only after checking the beginning, end and audio synchronisation."
    ],
    [
      "Čas {0} · HDR převedeno shodně do SDR pro náhled. Věrnost HDR ověř na TV. Stejný čas nezaručuje shodu při posunutém střihu.",
      "Timestamp {0} · Both HDR frames have been converted to SDR using the same preview settings. Check HDR fidelity on your TV. The same timestamp does not guarantee matching content when edits are offset."
    ],
    [
      "Čas {0} · Plné rozlišení snímků; detaily porovnej ve zvětšení 1 : 1. Stejný čas nezaručuje shodu při posunutém střihu.",
      "Timestamp {0} · Full-resolution frames; compare details at 1:1. The same timestamp does not guarantee matching content when edits are offset."
    ],
    [
      "Zvuk {0} → {1}; titulky {2} → {3}. Výstupní kodeky, jazyky a kanály odpovídají zdroji. Odebrané stopy: {4}.",
      "Audio {0} → {1}; subtitles {2} → {3}. Output codecs, languages and channels match the source. Removed tracks: {4}.",
      {
        "raw": [
          0,
          1,
          2,
          3
        ]
      }
    ],
    [
      "Chybí průkazné vzorky stejného páru stop na začátku, uprostřed a na konci. Uloženo měření: {0}.",
      "Conclusive samples of the same track pair at the beginning, middle and end are missing. Saved measurements: {0}.",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Operace byla přerušená ve fázi {0}. Neopakuj ji bez kontroly; zachované kopie nebyly smazané.",
      "The operation was interrupted at phase {0}. Do not repeat it without checking; retained copies were not deleted.",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Statistiky nelze aktualizovat; poslední údaje mohou být zastaralé. {0}",
      "Statistics cannot be updated; the last loaded data may be stale. {0}"
    ],
    [
      "Údaje nejsou aktuální. Poslední načtení {0}. Změny jsou zablokované.{1}",
      "The data is not current. Last loaded {0}. Changes are blocked.{1}"
    ],
    [
      "Stav obnov není dostupný. Poslední údaje zůstávají zobrazené: {0}",
      "Recovery status is unavailable. The last loaded data remains visible: {0}"
    ],
    [
      "Film je schválený, ale důkaz pro úklid karantény se neuložil: {0}",
      "The movie was approved, but evidence for quarantine cleanup could not be saved: {0}"
    ],
    [
      "Originál vlevo ({0} s), pak převod vpravo ({1} s). Úsek od {2} s. {3} → {4}.",
      "Original in the left channel ({0} s), then the transcode in the right channel ({1} s). Clip starts at {2} s. {3} → {4}.",
      {
        "raw": [
          3,
          4
        ]
      }
    ],
    [
      "Film je nahrazený, ale aktualizace údajů v Tdarru selhala: {0}",
      "The movie was replaced, but its Tdarr metadata update failed: {0}"
    ],
    [
      "Čas {0} · {1} Stejný čas nezaručuje shodu při posunutém střihu.",
      "Timestamp {0} · {1} The same timestamp does not guarantee matching content when edits are offset."
    ],
    [
      "Zkontrolováno {0} z {1} · Odhad času zatím není dostupný",
      "Checked {0} of {1} · Time estimate not available yet"
    ],
    [
      "{0}. Shoda rozlišení a kontrol podporovaného profilu.",
      "{0}. Matching resolution and supported profile checks.",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Pozdější úspěšné rozhodnutí pro stejnou položku: {0}",
      "Later successful decision for the same item: {0}"
    ],
    [
      "Čekám na další údaj o průběhu · poslední před {0} s",
      "Waiting for the next progress update · last update {0} s ago"
    ],
    [
      "Shodný počet: {0}. Časy kapitol se tímto nehodnotí.",
      "Matching count: {0}. Chapter timestamps are not assessed here.",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Zkontrolováno {0} · Odhad času zatím není dostupný",
      "Checked {0} · Time estimate not available yet"
    ],
    [
      "Uložení výsledku do archivu zamítnutí selhalo: {0}",
      "Saving the result to the rejection archive failed: {0}"
    ],
    [
      "Uložení záznamu do auditu rozhodnutí selhalo: {0}",
      "Saving the record to the decision audit failed: {0}"
    ],
    [
      "Film je vyřízený, ale úklid review selhal: {0}",
      "The movie was handled, but review cleanup failed: {0}"
    ],
    [
      "Vyžadována absolutní cesta v kontejneru: {0}",
      "An absolute container path is required: {0}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Aktualizováno {0} · obnova každé 2 sekundy",
      "Updated {0} · refreshes every 2 seconds"
    ],
    [
      "{0}: použij pouze http(s) adresu a port.",
      "{0}: use only an HTTP(S) address and port.",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Kontrola originálu · průchod {0}/2 · {1} %",
      "Original check · pass {0}/2 · {1} %"
    ],
    [
      "Dřívější chyba · opraveno ve verzi {0}",
      "Earlier error · fixed in version {0}"
    ],
    [
      "Originál {0} s; výstup {1} s; rozdíl {2} s.",
      "Original {0} s; output {1} s; difference {2} s.",
      {
        "raw": [
          0,
          1,
          2
        ]
      }
    ],
    [
      "{0} souborů · součást celkové úspory",
      "{0} files · included in total savings"
    ],
    [
      "Kontrola originálu, průchod {0} ze 2",
      "Original check, pass {0} of 2"
    ],
    [
      "Tento průchod běží {0} · Rychlost {1}×",
      "This pass has been running for {0} · Speed {1}×"
    ],
    [
      "Kontrola originálu · průchod {0}/2",
      "Original check · pass {0}/2"
    ],
    [
      "Kontrola originálu · průchod {0}/2{1}",
      "Original check · pass {0}/2{1}"
    ],
    [
      "Rychlost {0}× přehrávání · {1} sn./s",
      "Speed {0}× playback · {1} fps"
    ],
    [
      "Úklid karantény po schválení: {0}",
      "Quarantine cleanup after approval: {0}"
    ],
    [
      "{0} případů · poslední načtení {1}",
      "{0} cases · last loaded {1}"
    ],
    [
      "{0} výsledků · zatím neuvolněno",
      "{0} outputs · not yet released"
    ],
    [
      "Překódovaný výsledek v čase {0}",
      "Transcoded result at {0}"
    ],
    [
      "Úspora {0} %; rozdíl délky {1} s. {2}",
      "Savings {0}%; duration difference {1} s. {2}",
      {
        "raw": [
          0,
          1
        ]
      }
    ],
    [
      "Připojení k Tdarru selhalo: {0}",
      "The Tdarr connection failed: {0}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Nahrazeno · logická úspora {0}",
      "Replaced · logical savings {0}"
    ],
    [
      "Další automatické hledání: {0}",
      "Next automatic search: {0}"
    ],
    [
      "Zkontrolováno {0} z {1} · Zbývá {2}",
      "Checked {0} of {1} · Remaining {2}"
    ],
    [
      "Technická shoda {0}/{1} bodů · {2}",
      "Technical match {0}/{1} points · {2}"
    ],
    [
      "{0} / {1} · obě kopie dohromady",
      "{0} / {1} · both copies combined"
    ],
    [
      "Poslech nelze připravit: {0}",
      "Cannot prepare listening samples: {0}"
    ],
    [
      "Hromadné schválení · {0} z {1}",
      "Batch approval · {0} of {1}"
    ],
    [
      "Zkontrolováno {0} · Zbývá {1}",
      "Checked {0} · Remaining {1}"
    ],
    [
      "Čeká na měření · Zbývá {0}",
      "Waiting for a measurement · Remaining {0}"
    ],
    [
      "Zkontrolováno {0} / {1} filmu",
      "Checked {0} / {1} of the movie"
    ],
    [
      "Do konce tohoto kroku: {0}",
      "Time remaining in this step: {0}"
    ],
    [
      "Nelze vytvořit snímek: {0}",
      "Cannot create a frame: {0}"
    ],
    [
      "{0} upozornění v historii",
      "{0} history warnings"
    ],
    [
      "Strana {0} z {1} · {2} událostí",
      "Page {0} of {1} · {2} events"
    ],
    [
      "Tento průchod běží {0} · ",
      "This pass has been running for {0} · "
    ],
    [
      "Nelze připravit zvuk: {0}",
      "Cannot prepare audio: {0}"
    ],
    [
      "Tento průchod běží {0} ·",
      "This pass has been running for {0} ·"
    ],
    [
      "Rychlost {0}× přehrávání",
      "Speed {0}× playback"
    ],
    [
      "Akce tehdy selhala: {0}",
      "The operation failed at the time: {0}"
    ],
    [
      "{0} souborů · průměr {1} %",
      "{0} files · average {1} %"
    ],
    [
      "Schválit vybrané ({0})",
      "Approve selected ({0})",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Prohlédnout obnovu {0}",
      "View recovery for {0}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Tento průchod běží {0}",
      "This pass has been running for {0}"
    ],
    [
      "Porovnání obrazu · {0}",
      "Image comparison · {0}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Nastavení uloženo. {0}",
      "Settings saved. {0}"
    ],
    [
      "Stav aktualizován: {0}",
      "Status updated: {0}"
    ],
    [
      "Nedoloženo · {0} stop",
      "Not confirmed · {0} tracks"
    ],
    [
      "Poslední výpočet: {0}",
      "Last calculation: {0}"
    ],
    [
      "Kontrola náhrady: {0}",
      "Replacement check: {0}"
    ],
    [
      "{0}. Kontrolní součty",
      "{0}. Checksums"
    ],
    [
      "{0} — porovnání zvuku",
      "{0} — audio comparison",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Porovnání zvuku · {0}",
      "Audio comparison · {0}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Poslední hledání: {0}",
      "Last search: {0}"
    ],
    [
      "Tdarr neodpovídá: {0}",
      "Tdarr is not responding: {0}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Stav nelze ověřit ({0})",
      "Status unverified ({0})"
    ],
    [
      "Velikost zobrazených souborů: {0}",
      "Size of displayed files: {0}"
    ],
    [
      "Vyžaduje zásah ({0})",
      "Needs attention ({0})"
    ],
    [
      "Zkontrolováno {0} z {1}",
      "Checked {0} of {1}"
    ],
    [
      "Film zpracovávám {0}",
      "Movie processing time: {0}"
    ],
    [
      "{0} · {1} · {2} % · odhad {3}",
      "{0} · {1} · {2} % · estimated {3}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Vyřazené vydání: {0}",
      "Excluded release: {0}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Schválit {0} filmů?",
      "Approve {0} movies?"
    ],
    [
      "{0} obnov k ověření",
      "{0} recoveries to check"
    ],
    [
      "{0} z {1} · chyby: {2} · {3}",
      "{0} of {1} · errors: {2} · {3}"
    ],
    [
      "Originál v čase {0}",
      "Original at {0}"
    ],
    [
      "{0}: {1} · {2} · {3} kan. · {4}",
      "{0}: {1} · {2} · {3} ch. · {4}",
      {
        "raw": [
          1,
          2,
          4
        ]
      }
    ],
    [
      "Neplatný seznam {0}",
      "Invalid list {0}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Schválit {0} filmů",
      "Approve {0} movies"
    ],
    [
      "Rychlost {0} MiB/s",
      "Speed {0} MiB/s"
    ],
    [
      "Nelze načíst {0}: {1}",
      "Cannot read {0}: {1}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "zvuk {0}, titulky {1}",
      "audio {0}, subtitles {1}",
      {
        "raw": [
          0,
          1
        ]
      }
    ],
    [
      "Zkontrolováno {0}",
      "Checked {0}"
    ],
    [
      "Zkontrolováno {0}{1}",
      "Checked {0}{1}"
    ],
    [
      "Neplatné pole {0}",
      "Invalid field {0}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Možná úspora {0}",
      "Potential savings {0}"
    ],
    [
      "{0} z {1} · chyby: {2}",
      "{0} of {1} · errors: {2}"
    ],
    [
      "{0} z {1} · chyby: {2}{3}",
      "{0} of {1} · errors: {2}{3}"
    ],
    [
      "Dokončeno ({0})",
      "Completed ({0})"
    ],
    [
      "{0}. Kopírování",
      "{0}. Copying"
    ],
    [
      "Karanténa · {0}",
      "Quarantine · {0}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "{0} · {1} · odhad {2}",
      "{0} · {1} · estimated {2}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "{0} není složka",
      "{0} is not a folder",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "{0} není soubor",
      "{0} is not a file",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "asi {0} h {1} min",
      "about {0} h {1} min"
    ],
    [
      "{0}. Dokončení",
      "{0}. Finishing"
    ],
    [
      "Probíhá ({0})",
      "In progress ({0})"
    ],
    [
      "Chyby: {0} · {1}",
      "Errors: {0} · {1}"
    ],
    [
      "Rychlost {0}×",
      "Speed {0}×"
    ],
    [
      "Krok {0} ze 6",
      "Step {0} of 6"
    ],
    [
      "Posoudit {0}",
      "Review {0}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "{0}. Soubory",
      "{0}. Files"
    ],
    [
      "Náhrada: {0}",
      "Replacement: {0}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "{0} · {1} stop",
      "{0} · {1} tracks",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "asi {0} min",
      "about {0} min"
    ],
    [
      "{0}. Výměna",
      "{0}. Replacement"
    ],
    [
      "{0} % filmu",
      "{0} % of the movie"
    ],
    [
      "{0} v čase {1}",
      "{0} at {1}"
    ],
    [
      "titulky {0}",
      "subtitles {0}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Vybrat {0}",
      "Select {0}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Čeká ({0})",
      "Waiting ({0})"
    ],
    [
      "Důvod: {0}",
      "Reason: {0}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Chyby: {0}",
      "Errors: {0}"
    ],
    [
      "Chyby: {0}{1}",
      "Errors: {0}{1}"
    ],
    [
      "Zbývá {0}",
      "Remaining {0}"
    ],
    [
      "zvuk {0}",
      "audio {0}",
      {
        "raw": [
          0
        ]
      }
    ],
    [
      "Jazyk {0} nelze jednoznačně přiřadit k hlavním stopám. Vyber pár ručně.",
      "Language {0} cannot be matched reliably to the main tracks. Select the pair manually.",
      {
        "raw": [
          0
        ]
      }
    ]
  ]
};
