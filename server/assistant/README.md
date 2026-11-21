# server/assistant

Poslovi AI pomoćnika na strani workera prema [Karti servera](../../docs/server-map.md) i ugovoru Ductus `docs/contracts/ai-request-v1.md` (M9.0-S2). Za sada samo korak 5: posao čišćenja i svođenja (`sweep/`, SRV-1205).

## Što radi

Skener (`scanSweepDue`) kroz `assistant.sweep_due` dobije ID-ove zahtjeva koje treba počistiti ili svesti i za svaki stavi jedan posao `assistant_sweep` u red; tijelo posla je samo `requestId` (M10). Obrada posla (`createSweepHandler`) zove `assistant.sweep_and_settle(request_id)`: zastarjeli `reserved` postaje `rejected` uz oslobađanje troška, `sent` bez ishoda postaje `outcome_unknown`, a `outcome_unknown` se svodi jednom, na rezervirani iznos (do OA-1 nema upita o stvarnom trošku). Dvostruko pokretanje svodi jednom; svođenje pomiče točno brojače zapisane u retku knjige (T6) i nikad ne pušta da novi zahtjev prijeđe granicu (I4). Rokovi su imenovane konstante baze (`stale_reserved_after`, `stale_sent_after`); zrcala u kodu (`STALE_RESERVED_AFTER_SECONDS`, `STALE_SENT_AFTER_SECONDS`) provjerava integracijski test.

## Tko ga zove

Proces workera (VS-1b dio 2/3, još ne postoji): svakih `SWEEP_SCAN_EVERY_SECONDS` pokrene skener i obrađuje red `assistant_sweep` s postavkama `ASSISTANT_SWEEP_QUEUE`. Portove (`SweepPorts`) veže na svoju vezu uloge `ductus_worker` (`sweepAndSettle`, `sweepDue` iz `server/database`), a `enqueue` na red iz `server/database/queue`. Web proces ga ne zove.

## Koje podatke dira

Samo kroz RPC-ove sheme `assistant` koje smije `ductus_worker`: `sweep_due` (čita samo ID-ove) i `sweep_and_settle` (stanje zahtjeva, knjiga troška, brojači). U redu `pgboss.job` je samo ID zahtjeva. Nema teksta, iznosa, pružatelja ni studenta.

## Što izvozi

`ASSISTANT_SWEEP_JOB`, `ASSISTANT_SWEEP_QUEUE`, konstante `STALE_RESERVED_AFTER_SECONDS`, `STALE_SENT_AFTER_SECONDS`, `SWEEP_SCAN_EVERY_SECONDS`, `SWEEP_SCAN_LIMIT`, `createSweepHandler`, `scanSweepDue` i tipove `SweepEnqueue`, `SweepHandler`, `SweepPorts`, `SweepRefusalCode`, `SweepScan`.

## Što ne smije uvoziti

Smije uvoziti `settings`, `log`, `metrics`, `domain` i `database` (samo `import type`, tipovi portova).
