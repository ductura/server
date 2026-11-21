# Radnik

Pozadinski proces Ducture (ARCHITECTURE §2: web i radnik dijele module, a svaki ima svoj sastavljač). Prvi dio je potpis potvrda koje čekaju potpis (`signing/`, SRV-1502, plan M3.2, B-9, D-210).

## Što radi

- `signing/`: radnik koji potpisuje potvrde u stanju `pending_signature` (protokol 2, odgovor `202 pending_signature`) i oporavlja one koje je ostavio radnik koji je pao usred potpisa. Prvi prolaz nakon pokretanja obuhvaća svaku takvu potvrdu, zatim prolaz svakih `intervalMs`. Svaki prolaz piše jedan strukturirani zapis s brojem potvrda koje još čekaju potpis.
- Potpis iste potvrde uvijek su isti bajtovi (Ed25519 je deterministički, ulaz potpisa određuje spremljeni tekst), a spremište čuva prvi potpis (`already_signed` za svaki sljedeći), pa ponovljeni prolaz nakon pada nikad ne daje drugu potvrdu.

## Tko ga zove

Ulazna točka procesa radnika (planirana). Web proces ga ne gradi (D-71, D-102).

## Koje podatke dira

Ništa izravno. Čita i piše samo kroz portove `database` (red potvrda, ključevi domene, upis potpisa, objekt odsječka, sve pod prijavom `ductus_worker`), `evidence` (provjera objekta, potpis jedne potvrde, prolaz) i `external/storage` (HEAD objekta). Zapis prolaza sadrži samo brojeve, nikad ID ni tekst potvrde.

## Što izvozi

`createReceiptSigningWorker`, `DEFAULT_RECEIPT_SIGNING_CONFIG`, granice konfiguracije, imena događaja zapisa (`RECEIPT_SIGNING_PASS_EVENT`, `RECEIPT_SIGNING_FAILED_EVENT`), `passFields` i tipove.

## Što ne smije uvoziti

Ništa osim `log`, `database`, `evidence` i `external/storage` (docs/server-map.md §2), i to samo tipove iz `external/storage`. Ključ potpisa ne čita iz okoline ni datoteke: dobiva ga kao port potpisa, u testovima uvijek lažni.
