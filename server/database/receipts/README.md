# Objekt pending potvrde

Čitanje radnika (SRV-1502, plan M3.2, B-9; DAN-301): koji objekt odsječka imenuje potvrda koja još čeka potpis. Adapter `createPendingReceiptObjectSource(pool)` poziva postojeću funkciju `app.worker_receipt_object(domena, potvrda)` pod prijavom radnika (`ductus_worker`) i vraća oblik porta `PendingReceiptObjectSource` (`server/application/ports/pending-receipt-object.ts`).

## Što radi

- Jedan poziv, jedna naredba; ID domene i potvrde idu kao parametri, a oblik se provjerava prije baze (`request_invalid`).
- Nijedan redak je `not_found`: potpisana potvrda, potvrda druge domene ili sheme, nepoznat ID.
- Svaki redak se provjerava (točno pet stupaca, ustanova kao uuid, cijeli broj bajtova); drugačiji oblik je `row_malformed`, greška upravljača `database_error`, nikad tekst upravljača.
- Sadržaj polja uspoređuje provjera objekta (`server/evidence/check-pending-receipt-object.ts`), ne ovaj adapter.

## Tko ga zove

Samo proces radnika (`server/worker/signing`) preko `server/database/index.ts`. Web proces ga ne gradi (D-71, D-102).

## Koje podatke dira

Samo čita, kroz SECURITY DEFINER funkciju koju smije izvršiti samo `ductus_worker`; nova tablica ni RPC nisu dodani.
