# server/external/assistant

Područje iz [karte servera](../../../docs/server-map.md).

## Što radi

Adapteri porta AI pomoćnika (`AssistantPort` iz [`server/domain/assistant`](../../domain/assistant/README.md); Ductus `docs/contracts/ai-request-v1.md`). Za sada postoji samo sintetički adapter `createSyntheticAssistant`: ne otvara mrežnu vezu i ne treba tajnu (S1, M9), a deterministično vraća svaku granu S2 iz skripte koju mu preda pozivatelj: uspjeh, grešku pružatelja (s prijavljenim troškom ili bez njega), istek, prekid nakon slanja, zakašnjeli odgovor (`deliverLate`) i trošak veći od rezervacije. Bilježi svaki ulaz porta (`calls`), da test pokaže što bi otišlo pružatelju (G8). Ulaz koji nije točno ulaz porta odbija kao programsku grešku. Stvarni adapter čeka M9.1 (OA-1, OA-8), a grane alata #1664.

## Tko ga zove

`http`: ruta AI proxyja (`server/http/assistant`, SRV-1204, korak 4 ugovora) prima port i preko ovog sučelja čita ono što joj treba iz domene (parser zahtjeva, sastav uputa, ulaz porta, provjeru pružatelja), jer `http` ne smije uvoziti `domain`. Sintetički adapter stvaraju samo testovi; produkcijska kompozicija nema adaptera.

## Koje podatke dira

Ništa trajno. Ulaz porta postoji samo tijekom poziva i u popisu `calls` sintetičkog adaptera.

## Što izvozi

- `createSyntheticAssistant(script)`: sintetički adapter; jedna grana se ponavlja, popis grana troši se redom;
- `SYNTHETIC_BRANCHES`, `SyntheticBranch`, `SyntheticAssistant`;
- `syntheticAnswer`: deterministični tekst odgovora, rezan na `maxResponseCodePoints`;
- prosljeđeno iz domene za rutu: `parseAssistantRequest`, `composeInstructions`, `buildPortInput`, `checkResponse`, `parseProviderEntry`, `AI_POLICIES`, `PURPOSE_CATALOG_VERSIONS` i njihovi tipovi.

## Što ne smije uvoziti

Smije uvoziti samo `domain`. Ne uvozi druge adaptere iz `external/` ni feature područja, ne čita okolinu i ne otvara mrežu. Popis je u [karti servera, §2](../../../docs/server-map.md#2-dopušteni-uvozi).
