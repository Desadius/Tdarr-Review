# Tdarr Review — český přehled

Review je schvalovací aplikace mezi Tdarrem a filmovou knihovnou. Tdarr uloží výsledek do samostatné složky. Uživatel porovná obraz a zvuk a schválí výměnu; Review ověří soubory, bezpečně nainstaluje výsledek a zaznamená průběh.

Rozhraní je v češtině. Dokumentace repozitáře je převážně anglicky, aby ji mohl použít i jiný provozovatel Tdarru.

1. [Instalace na Unraid](INSTALL-UNRAID.md): Docker image, složky, oprávnění, přihlášení.
2. [Nastavení](CONFIGURATION.md): adresa Tdarru, cesty originálů a výsledků, Radarr.
3. [Používání](USER-GUIDE.md): jednotlivé a hromadné schválení, porovnání, zamítnutí.
4. [Propojení s Tdarrem](TDARR-INTEGRATION.md): umístění Guard/Receipt a kontrola úloh.
5. [Obnovy a karanténa](ARCHITECTURE.md): potvrzení chyby originálu, hledání náhrad, sedmidenní uchování.
6. [Provoz a opravy](OPERATIONS.md): zálohy, aktualizace, nejasné transakce a chyby připojení.
7. [Community Applications](COMMUNITY-APPS.md): připravená šablona a stav podání do katalogu. Připravená šablona sama neznamená, že je aplikace již v katalogu.
8. [Přechod na 2.0](MIGRATE-TO-2.0.md): převod instalace se dvěma kontejnery na jeden.
9. [Přidání cest TV](ADD-TV-PATHS.md): příprava neaktivního návrhu cest TV a bezpečná kontrola existujících mapování.

Návrh cest TV je pouze základ. Nevyhledává epizody a neopravňuje k výměně souborů. Zobrazená složka `/media/tvshows` potvrzuje pouze přístup kontejneru; cesty TV se konfigurují samostatně. Filmy fungují i bez volitelného návrhu TV. Podrobnosti a migrační kontrolní seznam jsou v [anglickém návodu](ADD-TV-PATHS.md).

Před změnou si soukromě zazálohujte aktuální nastavení Review a šablonu kontejneru. Ověřte, které cesty jsou v kontejneru skutečně připojené a čitelné či zapisovatelné pod UID 99/GID 100. Viditelný `/media/tvshows` znamená přístup přes Docker; sám o sobě nenastavuje knihovnu TV. Zapište zvlášť cesty originálů a výsledků v Review, zdrojové a výsledkové cesty Tdarru (na Windows mohou mít jinou podobu), kořen Sonarru a prefix výsledků TV. Prefix TV musí zůstat odlišný od filmového `PROD-Movies`.

Uložte návrh cest TV s vypnutým zpracováním a spusťte **Ověřit cesty knihoven**. Kontrola přes GET pouze čte metadata cest a oprávnění; nevytváří soubory a nevolá API Tdarru ani Sonarru. Změna mapování vyžaduje samostatně schválené, ručně zkontrolované znovuvytvoření pouze Review kontejneru, naplánované na dobu bez aktivní práce. Ponechte filmové cesty, relace, schválení i čekající žurnály beze změny. Nepoužívejte root, `chmod 777` ani rekurzivní změny oprávnění. Úprava proměnných prostředí nebo šablony sama nezmění aktivní konfiguraci.

Volitelný [ruční prohlížeč metadat Sonarru](SONARR-INSPECTOR.md) načte série a vazby epizod až po výslovné akci uživatele nad uloženým návrhem. Výsledky jsou neověřená metadata; nezapínají zpracování TV a neopravňují k výměně souborů.

V prohlížeči lze také výslovně porovnat diskovou složku jedné vybrané série s úplným snímkem Sonarru. Porovnání používá právě použitá nastavení, bezpečně čte jen metadata dané složky a při neúplném nebo měnícím se pozorování neurčuje chybějící ani místní soubory. Nic neopravuje, neschvaluje, nemění v Sonarru ani nečte obsah médií; podrobnosti a limity jsou v [návodu k prohlížeči Sonarru](SONARR-INSPECTOR.md#selected-series-disk-reconciliation).

Od verze 2.0.0 obsahuje image Review i volitelnou obnovu (Recovery). Samostatný image Recovery a služba `recovery` v Compose končí. Recovery je ve výchozím stavu vypnutá a řídí ji jediné nastavení `RECOVERY_MODE`: `off` (neběží), `verify` (potvrzuje poškozené originály a mimo sebe nic nemění, kromě ochranných kroků rozpracovaných oprav, které originál vracejí do knihovny nebo brání jeho novému převodu v Tdarru) nebo `repair` (smí opravit potvrzené poškození v nastavených limitech). Konfigurace a soukromý registr schválení jsou v `/data/recovery/`. Kdo dosud provozoval samostatný kontejner Recovery, postupuje podle [návodu k přechodu](MIGRATE-TO-2.0.md): stará data zkopíruje, zmrazené cesty `/storage` zachová dalším mapováním, pro hlášení Tdarru přidá mapování `/reports` (nebo, když je registr nezmrazil, nastaví `reports` na `/tdarr/JobReports`) a starý kontejner odstraní. Šablonu starého kontejneru v Unraidu si ponechá, dokud přechod neověří, aby jej mohl při návratu znovu vytvořit.

Před aktualizací na 2.1.0 si přečtěte oddíl [Before updating](../CHANGELOG.md#before-updating-4) v historii změn. Konfiguraci Recovery (`config.json`) ověřte novým image ještě před aktualizací, protože 2.1.0 odmítne chybějící nebo nepoužitelné hodnoty. Nové nastavení v rozhraní začne platit až tlačítkem **Použít změny**. První použití je jednosměrné: verze 2.0.0 by po návratu běžela s hodnotami z doby před ním.

Ve verzi 2.2.0 tlačítko **Použít změny** vyžaduje nejdřív **Otestovat uložený návrh**. Test ukáže, co použití smaže: uložená posouzení a rozhodnutí Approve se mažou jen při změně cest, knihovny, Tdarru nebo FFprobe. Podrobnosti jsou v oddílu [Before updating](../CHANGELOG.md#before-updating-3).

Verze 2.3.0 dává případům **Vyžaduje zásah** konkrétní akce: vysvětlí selhaný převod a nabídne jeden způsobilý opakovaný převod, umožní případ odložit s poznámkou a stáhnout redigovaný diagnostický export. Přidává také přípravu TV pouze pro čtení: přesnou vazbu epizod v Sonarru, šablonu TV flow pro Tdarr a volitelné objevování TV výsledků. TV výsledky zatím nelze schválit ani nainstalovat. Po aktualizaci obnovte dotčené diagnózy Recovery tlačítkem **Obnovit stav** a před návratem ke starší verzi dokončete každé obnovení originálu; podrobnosti jsou v oddílu [Before updating](../CHANGELOG.md#before-updating-2).

Ve verzi 2.4.0 je posouzení ve Review jeden průchod po třech úsecích přes celou obrazovku: každý úsek zazní jednou, po něm potvrdíte obraz, zvuk a synchronizaci klávesami a každé potvrzení se hned uloží; rozhodnutí následuje po posledním úseku. Posouzení uložená v novém průchodu verze 2.3.0 nepřečte, proto filmy schválené po aktualizaci nahraďte ještě před případným návratem; podrobnosti jsou v oddílu [Before updating](../CHANGELOG.md#before-updating-1).

Ve verzi 2.5.0 každý případ **Vyžaduje zásah** jednou větou řekne, co se po vás chce, a nabídne akci: **Ponechat aktuální kopii**, **Uzavřít beze změny** (poznámka je nepovinná) nebo smazání souboru v dialogu **Karanténa** po potvrzení. Stav se ověřuje sám, takže tlačítka pro obnovení zmizela, a diagnostický export je v **Nastavení**. Recovery už nehlásí krátký výpadek Radarru jako ruční zásah a případy zapsané pod jiným připojením stejného sdílení (`/storage` místo `/media`) dostanou své akce. Před návratem k 2.4.0 počítejte s tím, že případy uzavřené bez poznámky a případy se smazanou karanténou se vrátí; podrobnosti jsou v oddílu [Before updating](../CHANGELOG.md#before-updating).

V sekci **Nastavení** otevírají tlačítka Review i Radarr společný průvodce. Odděluje **Uložit návrh**, **Otestovat uložený návrh** a **Použít změny**; uložení funguje i při výpadku služeb. Po použití je autoritou celé konfigurace soukromý `/data/shared-settings.json`, původní soubory slouží jako vstupy migrace. Rozhraní rozlišuje návrh, používanou generaci a skutečný stav Recovery. Použití bezpečně dokončí běžící operaci, počká na Review a restartuje pouze Recovery. Čekání lze zrušit; při chybě se staré cesty automaticky neobnoví a přerušené použití se samo neopakuje. Režim dál určuje RECOVERY_MODE. Soukromý registr a historické výjimky zůstávají v souborech a zmrazené či nedokončené případy vyžadují samostatnou migraci. Nová instalace standardně sleduje chyby až od dokončení nastavení; starší historie vyžaduje výslovnou volbu. Podrobnosti: [správa konfigurace](USER-GUIDE.md#configure-review-and-recovery).

Film je zablokovaný, pokud výsledek nesplňuje přísná pravidla převodu: originál h264, hevc, vc1 nebo mpeg2video s jedinou video stopou; výsledek HEVC 10 bit (`yuv420p10le`) ve stejném rozlišení se značkou povoleného HDR/SDR profilu; zvukové stopy a titulky pouze z originálu (stejný kodek, počet kanálů a jazyk, odebrat lze, přidat ani změnit ne) a stejný počet kapitol. Důvod blokace uvádí, které pravidlo selhalo. Podrobnosti jsou v [Používání](USER-GUIDE.md#why-a-film-is-blocked).

Skóre kontroly vyjadřuje množství doložených kontrol, nikoli procentní pravděpodobnost bezvadného filmu. Úspory ukazují doložený rozdíl velikostí souborů; nemusí odpovídat okamžité změně volného místa array.

V repozitáři nejsou skutečné API klíče, SSH klíče, seznamy osobních filmů, transakční protokoly ani osobní schválení oprav. Existující produkční instalace se tímto zveřejněním nemění.

Vestavěné řízené porovnání je jeden průchod po třech úsecích přes celou obrazovku: každý úsek zazní jednou, po něm potvrdíš obraz, zvuk a synchronizaci klávesami a každé potvrzení se hned uloží; přehrávání samo nic nepotvrzuje. Pro průběh, klávesnici a limity ukázek viz [návod k řízenému porovnání](GUIDED-COMPARISON.md) a [uživatelský návod](USER-GUIDE.md#review-a-film).
