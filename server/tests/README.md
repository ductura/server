# server/tests

Područje iz [karte servera](../../docs/server-map.md): provjere preko više područja koje su uvjet builda.

## Što radi

Drži testove koji uspoređuju izlaze više područja. Prvi je test jednakosti prikaza ([equality/](equality/README.md), plan M7.9, R-07, SRV-1512): tekst izmišljenog rada iz API-ja, iz izvoznog snapshota (SRV-1309) i iz izvoza DOCX mora biti isti.

## Tko ga zove

Samo testovi. CI ga pokreće kao zaseban korak „Test jednakosti prikaza (R-07)” posla „Provjere i testovi” (`pnpm test:equality`).

## Koje podatke dira

Samo izmišljeni podaci iz `equality/display-equality.test.ts`. Ne otvara bazu, pohranu ni mrežu.

## Što izvozi

Ništa: `index.ts` je prazan, jer područje drži samo testove i nitko ga ne uvozi.

## Što ne smije uvoziti

Smije uvoziti samo `domain` i `downloads`. Popis je u [karti servera, §2](../../docs/server-map.md#2-dopušteni-uvozi).
