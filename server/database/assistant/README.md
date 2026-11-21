# assistant

Priključak baze za zahtjeve AI pomoćnika (SRV-1203, korak 3 ugovora Ductus `docs/contracts/ai-request-v1.md`, migracija `20261122110000_assistant_request_rpcs.sql`). Jedan poziv je jedna `withActor` transakcija nad jednim RPC-om sheme `assistant`: rezervacija (`begin_request`), slanje (`mark_sent`), završetak (`complete_request`), greška pružatelja (`fail_request`), nepoznat ishod (`mark_outcome_unknown`), čitanje razgovora i objava granica administratora. `sweepAndSettle` je poziv workera s vezom uloge `ductus_worker` i nosi samo ID zahtjeva.

Vlasništvo, politiku, konfiguraciju troška i budžet odlučuje baza; iznosi, granice i student nikad ne dolaze odavde. Odgovor je zatvoren status, nikad poruka baze. Ruta (korak 4) zove pružatelja tek kad `markSent` vrati `sent`.

`sweepDue` (SRV-1205, migracija `20261122120000_assistant_sweep_due.sql`) je popis workera: najviše zadani broj (1 do 1000) ID-ova zahtjeva koje bi `sweep_and_settle` sada promijenio, najstariji prvi, i ništa drugo. Rokove (`stale_reserved_after`, `stale_sent_after`) drži baza. Zove ga posao čišćenja i svođenja u `server/assistant/sweep`.
