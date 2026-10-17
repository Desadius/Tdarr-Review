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

Od verze 2.0.0 obsahuje image Review i volitelnou obnovu (Recovery). Samostatný image Recovery a služba `recovery` v Compose končí. Recovery je ve výchozím stavu vypnutá a řídí ji jediné nastavení `RECOVERY_MODE`: `off` (neběží), `verify` (potvrzuje poškozené originály a mimo sebe nic nemění, kromě ochranných kroků rozpracovaných oprav, které originál vracejí do knihovny nebo brání jeho novému převodu v Tdarru) nebo `repair` (smí opravit potvrzené poškození v nastavených limitech). Konfigurace a soukromý registr schválení jsou v `/data/recovery/`. Kdo dosud provozoval samostatný kontejner Recovery, postupuje podle [návodu k přechodu](MIGRATE-TO-2.0.md): stará data zkopíruje, zmrazené cesty `/storage` zachová dalším mapováním, pro hlášení Tdarru přidá mapování `/reports` (nebo, když je registr nezmrazil, nastaví `reports` na `/tdarr/JobReports`) a starý kontejner odstraní. Šablonu starého kontejneru v Unraidu si ponechá, dokud přechod neověří, aby jej mohl při návratu znovu vytvořit.

V sekci **Nastavení** otevírají tlačítka Review i Radarr společný průvodce. Odděluje **Uložit návrh**, **Otestovat uložený návrh** a **Použít změny**; uložení funguje i při výpadku služeb. Po použití je autoritou celé konfigurace soukromý `/data/shared-settings.json`, původní soubory slouží jako vstupy migrace. Rozhraní rozlišuje návrh, používanou generaci a skutečný stav Recovery. Použití bezpečně dokončí běžící operaci, počká na Review a restartuje pouze Recovery. Čekání lze zrušit; při chybě se staré cesty automaticky neobnoví a přerušené použití se samo neopakuje. Režim dál určuje RECOVERY_MODE. Soukromý registr a historické výjimky zůstávají v souborech a zmrazené či nedokončené případy vyžadují samostatnou migraci. Nová instalace standardně sleduje chyby až od dokončení nastavení; starší historie vyžaduje výslovnou volbu. Podrobnosti: [správa konfigurace](USER-GUIDE.md#configure-review-and-recovery).

Film je zablokovaný, pokud výsledek nesplňuje přísná pravidla převodu: originál h264, hevc, vc1 nebo mpeg2video s jedinou video stopou; výsledek HEVC 10 bit (`yuv420p10le`) ve stejném rozlišení se značkou povoleného HDR/SDR profilu; zvukové stopy a titulky pouze z originálu (stejný kodek, počet kanálů a jazyk, odebrat lze, přidat ani změnit ne) a stejný počet kapitol. Důvod blokace uvádí, které pravidlo selhalo. Podrobnosti jsou v [Používání](USER-GUIDE.md#why-a-film-is-blocked).

Skóre kontroly vyjadřuje množství doložených kontrol, nikoli procentní pravděpodobnost bezvadného filmu. Úspory ukazují doložený rozdíl velikostí souborů; nemusí odpovídat okamžité změně volného místa array.

V repozitáři nejsou skutečné API klíče, SSH klíče, seznamy osobních filmů, transakční protokoly ani osobní schválení oprav. Existující produkční instalace se tímto zveřejněním nemění.
