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

Skóre kontroly vyjadřuje množství doložených kontrol, nikoli procentní pravděpodobnost bezvadného filmu. Úspory ukazují doložený rozdíl velikostí souborů; nemusí odpovídat okamžité změně volného místa array.

V repozitáři nejsou skutečné API klíče, SSH klíče, seznamy osobních filmů, transakční protokoly ani osobní schválení oprav. Existující produkční instalace se tímto zveřejněním nemění.
