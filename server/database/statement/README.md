# server/database/statement

## Što radi

Povezuje rute izjave s RPC-ovima `declaration` i provjerama iz domene izjave.

## Tko ga zove

Studentske rute u `server/http/statement`.

## Koje podatke dira

Aktera uzima iz sesije. Bazi šalje identifikator zadatka, provjereni studentski unos, konfigurirani obrazac ili izvorne bajtove priloga.

## Što izvozi

`createStatementPort` te tipove i provjere koje koriste rute i čitač obrasca.

## Što ne smije uvoziti

Adapter nema HTTP ovisnosti. Pristup bazi prolazi kroz `WithActor`.
