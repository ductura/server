# Čitanje DOCX-a za provenance

SRV-1802, M8.1 i M8.8 (D-198 t. 5). Lokalni spike koji na izmišljenim DOCX-ima provjerava što se iz paketa može pouzdano pročitati prije uvoza (M8.2, M8.9). Sav tekst, sva imena i datumi su izmišljeni; paketi se grade u memoriji (`fixtures.ts`), pa u repou nema binarnih datoteka. [Plan migracije](../../docs/plan/PLAN-MIGRACIJE.md)

## Ishod

**Spike je prošao.** Čitač `readDocx` (`docx-read.ts`) čini jednu čistu funkciju nad bajtovima: bez datotečnog sustava, bez mreže, bez izvršavanja ičega iz dokumenta. Na pet izmišljenih DOCX-a daje tekst, razine naslova, bilješke, tablice, praćene izmjene i komentare s autorom i datumom, broj rsid sesija, `core` i `app` svojstva te oznake paketa (makro, vanjske veze, ugrađeni objekti). Osam hostilnih ili pokvarenih ulaza odbija se zatvorenim kodom (`not_zip`, `encrypted`, `too_large`, `too_many_entries`, `uncompressed_too_large`, `missing_document`, `unsafe_xml`, `invalid_xml`). OSV skeniranje vlastitog lockfilea nema nalaza.

**Granica zaključka.** Izmjereno je samo na dokumentima koje piše `fixtures.ts`, po specifikaciji OOXML-a i po poznatim razlikama pisaca. Nema stvarnih datoteka iz Worda, Google Docsa ni LibreOfficea, pa tablica niže pokazuje što čitač izvlači kad signal postoji, a ne koliko često ga pravi pisci zapisuju. To treba izmjeriti prije oslanjanja na signale (rizici niže).

## Postav

| Dio          | Vrijednost                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| Raspakiranje | `fflate` 0.8.3 (bez ovisnosti), odluka o veličini iz središnjeg imenika prije nego se išta raspakira              |
| XML          | `fast-xml-parser` 5.12.1 uz `XMLValidator`; `preserveOrder`, bez obrade entiteta                                  |
| Lockfile     | `pnpm-lock.yaml` u ovom direktoriju; `pnpm-workspace.yaml` s praznim popisom ga drži izvan korijenskog workspacea |
| OSV          | `osv-scan.ts`, bez ovisnosti i bez treće akcije; CI posao `.github/workflows/docx-provenance-spike.yml`           |

Granice (`LIMITS`): paket 25 MiB, 500 zapisa, 100 MiB raspakirano, 50 MiB po dijelu. To su vrijednosti spikea; stvarne određuje M8.0-S1 (D-291).

## Što se pouzdano čita

Stupci su pet izmišljenih paketa. „da” znači da je signal u paketu i da ga je čitač izvukao točno kao što test očekuje.

| Signal                         | plain-word | tracked-review | footnotes-table | online-export | desktop-suite | Nađeno |
| ------------------------------ | :--------: | :------------: | :-------------: | :-----------: | :-----------: | -----: |
| tekst i broj riječi            |     da     |       da       |       da        |      da       |      da       |    5/5 |
| razine naslova                 |     da     |       -        |        -        |      da       |       -       |    2/5 |
| bilješke na dnu stranice       |     -      |       -        |       da        |       -       |       -       |    1/5 |
| tablice                        |     -      |       -        |       da        |       -       |       -       |    1/5 |
| praćene izmjene (autor, datum) |     -      |       da       |        -        |       -       |       -       |    1/5 |
| komentari (autor, datum)       |     -      |       da       |        -        |       -       |       -       |    1/5 |
| rsid sesije                    |     da     |       da       |       da        |       -       |      da       |    4/5 |
| `core.creator`                 |     da     |       da       |       da        |       -       |      da       |    4/5 |
| `core.lastModifiedBy`          |     da     |       da       |        -        |       -       |       -       |    2/5 |
| `core.created` i `modified`    |     da     |       -        |        -        |       -       |       -       |    1/5 |
| `core.revision`                |     da     |       da       |        -        |       -       |       -       |    2/5 |
| `app.application`              |     da     |       da       |        -        |       -       |      da       |    3/5 |
| `app.totalTime`                |     da     |       da       |        -        |       -       |      da       |    3/5 |
| vanjske veze                   |     -      |       -        |       da        |       -       |       -       |    1/5 |

Ponovno se dobiva s `node spikes/docx-provenance/report.ts`. Redovi označeni „-” znače da paket tog signala nema, a ne da ga čitač ne vidi; ono što fali, čitač vraća kao `null` ili prazan popis, nikad izmišljenu vrijednost.

Nalazi:

- **Tekst je jedino pouzdano prisutan** (5/5). Obrisani tekst praćenih izmjena (`w:delText`) nije u trenutnom tekstu, ali je u popisu izmjena. Kodni nizovi polja (`w:instrText`) ne ulaze u tekst; entiteti se dekodiraju točno jednom.
- **Metapodaci su neobvezni.** Izvoz bez `docProps` (`online-export`) nema ni autora ni vremena; takav dokument smije ući u uvoz, ali bez tih signala. Nijedan od njih nije dokaz autorstva.
- **`TotalTime` može biti 0** (`desktop-suite`), što nije isto što i „nepoznato”; čitač ih razlikuje.
- **Parser je popustljiv.** `fast-xml-parser` sam vraća djelomično stablo za neispravan XML (nezatvorene oznake), pa bi izgledalo kao dokument s manje odlomaka. Zato se prije parsiranja poziva `XMLValidator`, uz test.
- **Reference znakova** (`&#32;`, `&amp;` i u atributima) dekodiraju se jednom; razmaci između oznaka XML-a nisu tekst; preduboko gniježđenje (granica parsera 100 razina) postaje `invalid_xml`.
- **DOCTYPE i ENTITY** odbijaju se prije parsiranja (`unsafe_xml`): OOXML ih ne treba.
- **Zip bomba** (60 MiB nula, pakirano ispod 200 kB) odbija se iz središnjeg imenika, prije raspakiranja.

## Provjere

```sh
cd spikes/docx-provenance
pnpm install --frozen-lockfile --ignore-workspace
node --test *.test.ts            # 24 testa, 5 izmišljenih DOCX-a + hostilni ulazi + OSV logika
node osv-scan.ts pnpm-lock.yaml  # treba mrežu prema api.osv.dev
node report.ts
```

Vitest ne čita `spikes/` pa ovi testovi nisu u `pnpm test`, kao ni [prethodni spike](../encryption-deadline/README.md); CI ih vrti zasebnim poslom.

`osv-scan.ts` izlazi s 1 na svaki HIGH ili CRITICAL nalaz i na nalaz čiju ozbiljnost ne može pročitati (fail closed). Izlaz je provjeren i negativno: lockfile s `lodash@4.17.20` daje dva HIGH nalaza i kod 1. Napuštaju stroj samo imena i verzije paketa.

## Preporuka za M8.2 i M8.9

- Za čitanje uvoza koristiti ovu kombinaciju (`fflate` + `fast-xml-parser` s validatorom), uz granice iz M8.0-S1. Nijedna od dvije ovisnosti nema ovisnosti osim `fast-xml-parser` → `fast-xml-builder`, `@nodable/entities` i `anynum` (sve u lockfileu).
- Uvoz upisuje kao činjenicu samo ono što paket tvrdi, uz izvor „uvoz” (M8.0-S1); autor, vrijeme i `TotalTime` su tvrdnje datoteke, ne dokaz, i prikazuju se s napomenom „nije dokaz autorstva”.
- Odsutni signali su normalni (online izvoz): ni jedan ne smije blokirati uvoz ni ući u ocjenu.
- Makro (`vbaProject.bin`) i vanjske veze (`attachedTemplate`, `oleObject`, `hyperlink` s `TargetMode="External"`) samo se bilježe; ništa se ne otvara ni ne dohvaća.
- OSV posao ponoviti za svaki paket koji se doda u pravi uvoz, a lockfile pinati točnim verzijama kao ovdje.

## Rizici i otvorena pitanja

- **Nema stvarnih datoteka.** Treba izmjeriti na izmišljenim dokumentima koje su stvarno spremili Word, Google Docs i LibreOffice (ne na onima iz `fixtures.ts`): koliko često postoje `TotalTime`, rsid i `lastModifiedBy`, i kako izgledaju praćene izmjene s više autora.
- **Ne čita se** povijest verzija iz clouda (M8.11), slike, tekstualni okviri (`mc:AlternateContent` može udvostručiti odlomke), zaglavlja i podnožja, ni stari `.doc`.
- **Memorija.** `unzipSync` drži sve prihvaćene dijelove u memoriji; uz granice od 100 MiB to je gornja ocjena, nije mjereno. Za produkciju razmotriti čitanje po dijelovima.
- **Nova ranjivost** pojavljuje se bez promjene koda; zato CI posao ima i tjedni raspored.
