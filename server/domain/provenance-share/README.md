# server/domain/provenance-share

Udio predanog teksta iz zabilježenih događaja po ugovoru `ductura-provenance-share-v1` ([docs/contracts/provenance-share-v1.md](../../../docs/contracts/provenance-share-v1.md), odjeljci 1, 3, 6, 7 i 9), SRV-1221. Samo čiste funkcije bez I/O-a; pohrana, posao workera, prekidač i rute dolaze u sljedećim koracima, a oznaka podudaranja (odjeljak 2) je u zasebnoj mapi (SRV-1222).

- **Kategorije** (`categories.ts`): zatvorena tablica izvora događaja (v2 do v4) u pet kategorija iz §1.2. Izvor koji nije u tablici, i rezervirani, nema kategoriju, pa izračun daje grešku, nikad tihu kategoriju.
- **Model tokena** (`token-document.ts`): dokument formata `ductus-edit-steps-v1` i `-v3` kao ravan niz ProseMirror tokena (početak bloka, znak po UTF-16 jedinici, inline atom, kraj bloka). `replace` je zamjena raspona tokena, `replaceAround` isto uz premješten procjep; znakovi nose kategoriju događaja koji ih je umetnuo i drže se u nizovima iste kategorije.
- **Izračun** (`share.ts`): `computeProvenanceShare` ponavlja korake lanca na modelu i uspoređuje rezultat s predanim dokumentom blok po blok (id, tekst, atomi, zbroj točaka jednak duljini teksta; invarijanta §1.3). Svako odstupanje, nepoznat izvor, korak koji model ne može primijeniti i dokument v4 (njegove korake još nijedan replayer ne čita) daju `{ ok: false }`, nikad udio. Pretpostavka je da je pozivatelj lanac već provjerio i ponovio replayerom editora.
- **Zaokruživanje** (`rounding.ts`): metoda najvećeg ostatka iz §1.4, samo cijeli brojevi (`bigint`).
- **Zapis** (`record.ts`): zatvorena provjera svih razina (§3), `provenanceRecordJcs`, `provenanceRecordSha256` i `parseProvenanceRecordV1Bytes` (samo kanonski JCS bajtovi). `share.percent` mora biti točno iz §1.4, a `notice` točno `not_authorship_evidence` (P-B).
- **Konstante** (`constants.ts`): sve iz §7 osim `MIN_MATCH_CODE_POINTS`, koji pripada oznaci podudaranja.

Testovi: `share.test.ts` (vektor §9.1, rubni slučajevi, greške, trošak), `share.property.test.ts` (fast-check nad slučajnim lancima), `rounding.test.ts` (§9.2), `record.test.ts` (§9.5 i zatvoreni ključevi), `categories.test.ts` i `index.test.ts` (granice uvoza, P-A). Fixturei u `testdata/` napisani su ponavljanjem svakog događaja serverskim replayerima, pa ih oni prihvaćaju; sav tekst je izmišljen.

Uvozi samo [`../document`](../document/README.md), [`../forensics`](../forensics/README.md), [`../json`](../json/README.md) i `node:crypto`.
