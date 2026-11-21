# server/domain

Područje iz [karte servera](../../docs/server-map.md).

## Što radi

Čista pravila i modeli bez I/O-a, SQL-a i vendor SDK-ova. Preneseno iz Ductusa na `d52a92c3` (S-0.19, DAN-732) bez promjene logike, a kasnije mape na verziji navedenoj u tablici. Izmjene su samo uvozi (`.ts`, preko `index.ts`), tipovi pod strožim `tsconfig.json` (`!` gdje Ductus ne traži provjeru indeksa) i imena koja traži lint.

| Mapa                                           | Iz Ductusa                        | Što je                                                                                     |
| ---------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| [forensics](forensics/README.md)               | `src/domain/forensics`            | JCS, segmenti dokaza v2 do v4, lanac, kontrolne točke, potvrde, potpisi, testni vektori    |
| [evidence](evidence/README.md)                 | `src/domain/evidence`             | Osnova dokaza (tvrdnja, izvor, izvadak) i omotnica `commit` zahtjeva                       |
| [document](document/README.md)                 | dio `src/domain/document`         | Kanonski model dokumenta i koraci uređivanja koje forensics provjerava                     |
| [collaboration](collaboration/README.md)       | `src/domain/collaboration/anchor` | Sidro u tekstu koje osnova dokaza koristi                                                  |
| [json](json/README.md)                         | `src/domain/json.ts`              | Zajednički JSON tipovi i provjere                                                          |
| [settings](settings/README.md)                 | — (novo, S-1J-f)                  | Katalog postavki po razinama (D-298) i provjera pisanja                                    |
| [jobs](jobs/README.md)                         | `src/application/jobs/job-body`   | Tijelo posla u redu: samo identifikatori (D-74), na `333e163` (DAN-820)                    |
| [assignment](assignment/README.md)             | `src/domain/assignment`           | Jezik rada: zatvoreni skup i parser, na `4651a25` (DAN-909)                                |
| [profile](profile/README.md)                   | `src/domain/profile`              | Tijelo postavke jezika sučelja: skup i parser, na `51a062e` (DAN-851-1a)                   |
| [support](support/README.md)                   | `src/domain/support`              | Prijava problema: zatvorene klase, parser i predložak rute, na `220b5db` (DAN-851-2a2)     |
| [sync](sync/README.md)                         | dio `src/domain/sync/states.ts`   | Osam stanja sinkronizacije (`SYNC_STATES`), na `220b5db` (DAN-851-2a2)                     |
| [assistant](assistant/README.md)               | `src/domain/assistant` i novo     | Katalog svrha (DAN-402); port, parser, politika i stanja AI zahtjeva (SRV-1201)            |
| [declaration](declaration/README.md)           | — (novo, SRV-1210)                | Izjava o radu v1: payload, hash, privici, razlozi, tijelo spremanja, obrazac (ugovor #499) |
| [provenance-share](provenance-share/README.md) | — (novo, SRV-1221)                | Udio predanog teksta iz zabilježenih događaja i zapis `ductura-provenance-share-v1`        |

`result.ts` drži zajedničke tipove `Result<T>` i `AppError` (`{ code, messageKey }`, [docs/CODE_STYLE.md](../../docs/CODE_STYLE.md) §8); samo tipove, bez I/O-a.

## Tko ga zove

`database`, `external/storage`, `external/keys`, `external/assistant`, `session`, `roles`, `legal`, `backup`, `deletion`, `downloads`, `evidence`, `profile` i `support` (karta §1). Unakrsni testovi u `tests/contracts` i `tests/db` uvoze ga da dokažu slaganje s ugovorima i migracijama.

## Koje podatke dira

Ništa: nema I/O-a, SQL-a ni poziva vanjskih usluga.

## Što izvozi

`index.ts` izvozi sve mape i tipove iz `result.ts`. `SourceId` je iz `document`; istoimeni tip osnove dokaza izvozi se kao `EvidenceSourceId`.

## Što ne smije uvoziti

Ništa iz servera (karta §2: `domain` → —). Proizvodni kod smije koristiti samo `node:crypto`, a testovi još `node:fs`, `node:path`, `node:url`, `vitest`, `fast-check` i `@fast-check/vitest`. Provode to `server/domain/index.test.ts` i lint `local/area-boundary`.
