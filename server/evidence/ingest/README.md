# server/evidence/ingest

Prihvat tijela evidencije (M3.1, B-8; popis stavki u [docs/nalazi/M3.1.md](../../../docs/nalazi/M3.1.md)), dio područja `evidence` iz [Karte servera](../../../docs/server-map.md).

## Što radi

`parseClosedJsonObject(bytes, keys)` čita tijelo rute evidencije kao JSON objekt s točno zadanim ključevima, svakim napisanim jednom, iz strogog UTF-8 (oznaka redoslijeda bajtova ostaje znak i ruši parsiranje). Ključ napisan dvaput odbija se kao i nepoznat ključ (N-19 iz plana napada #1504, DAN-707): `JSON.parse` bi zadržao zadnju vrijednost, a provjera `Object.keys` prvu ne vidi. Ključevi se čitaju linearnim prolazom kroz tekst koji je `JSON.parse` već prihvatio, a izbjegnuti zapis (`"documentId"`) dekodira se prije usporedbe. Sve ostalo je `null`, a ruta odgovara zatvorenim kodom (`422 invalid`) bez ičega iz tijela.

Testovi: `closed-object.test.ts` (ponovljeni ključ, nepoznat ključ, BOM, neispravan UTF-8, tijelo od pet milijuna znakova) i `tampered-segment.property.test.ts`: segment promijenjen za jedan bajt (izbačen, dodan ili zamijenjen) kroz cijelu pripremu servisa `createEvidenceService` ili se odbija zatvorenim kodom bez pohrane i commita, ili se, kad je promjena i sama valjan kanonski segment, sprema i commita samo kao ti bajtovi pod svojim hashem. Nijedan ishod ne nosi dio primljenog segmenta.

Ponovljeni commit istog segmenta (M3.6, D-212): odgovor s prvom revizijom i `duplicate: true`, bez novog retka; test `server/http/evidence-commit-repeated.test.ts`, zapis u [docs/nalazi/M3.6.md](../../../docs/nalazi/M3.6.md).

## Tko ga zove

`server/evidence/ingest-http.ts` (predaja) i, preko `server/evidence/index.ts`, `server/http/evidence-request.ts` (`parseClosedObject` ruta open, commit, replay i submission).

## Koje podatke dira

Ništa: čista funkcija nad primljenim bajtovima.

## Što izvozi

`parseClosedJsonObject`.

## Što ne smije uvoziti

Ništa izvan područja `evidence` (karta servera: `evidence` smije `settings`, `log`, `metrics`, `domain`, `database`, `external/storage`).
