# server/tests/equality

Test jednakosti prikaza (plan M7.9, R-07, SRV-1512) u području [server/tests](../README.md).

## Što radi

`compareDisplayChannels` za jednu reviziju uspoređuje tri kanala i vraća svaku razliku:

- **API:** tekstni blokovi koje API šalje (`blocks` rute `teacher.fast-path.post`, `textBlocksOf`);
- **snapshot:** `ExportSnapshot` (SRV-1309): hash, vlastiti `canonicalJson` i revizija iz koje je zamrznut;
- **DOCX:** odlomci i dijelovi teksta (`w:r`) s jezikom (`w:lang`) iz `word/document.xml`, uključujući naslovnicu.

Sve je u jednoj datoteci, `display-equality.test.ts`, jer izmišljeni rad nosi hrvatski, engleski i njemački tekst, a poslužiteljski kod izvan testova ga ne smije imati (`local/no-hardcoded-text`). Očekivanje se čita neovisno o modelu izvoza: iz pohranjene revizije i karte sposobnosti snapshota. Vrsta čvora označena `omitted` (danas tablica, slika, fusnota, navod i unakrsna poveznica) ne smije ostaviti tekst u DOCX-u. Vrsta označena `exported` ili `degraded` mora ispisati svoj tekst u obliku zapisanom u testu. Za vrstu bez zapisanog oblika test pada dok se oblik ne zapiše u testu, pa pisac koji počne ispisivati tablice ili fusnote ne prolazi tiho.

`docxParagraphs` čita samo oznake koje piše izvoz iz `server/downloads/export`; nepoznat element je greška, ne preskače se.

## Tko ga zove

Test nad izmišljenim radom (fusnote, tablica, odlomci na engleskom i njemačkom, unakrsna poveznica, formule, okvir, blok koda, prijelom stranice). Isti test namjerno unosi razliku u svaki kanal i provjerava da pada te da je korak obavezan u CI-ju.

## Koje podatke dira

Samo izmišljeni podaci. Ništa ne sprema.

## Što izvozi

Ništa: `index.ts` je prazan.

## Što ne smije uvoziti

Kao područje [server/tests](../README.md): samo `domain` i `downloads`.
