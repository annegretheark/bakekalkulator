# Implementeringsplan – Rett i lomma – Matkalkulator

Videreutvikling av Bakekalkulatoren til en matkalkulator for privatpersoner, bakerier, restauranter, kafeer, catering, kantiner og matprodusenter. Grunnlag: kravspesifikasjonen (punkt 1–8 slik de ble limt inn 27.11.2026) og `KRAVSPESIFIKASJON.md`.

> **Merk:** `KRAVSPESIFIKASJON.md` inneholder bare fasene og arbeidsreglene, ikke selve punkt 9–20. Planen for fase 2–4 bygger derfor på overskriftene i fasene og må justeres når hele teksten foreligger.

## 1. Analyse av eksisterende løsning

| Område | Status før fase 1 | Gjenbruk |
|---|---|---|
| Frontend | React 19, Vite, TypeScript, hash-ruting, én side per menypunkt | Alle sider og komponenter beholdes |
| Beregning | Rene funksjoner i `src/utils` (strøm, ingredienser, skalering, salg) | Utstyrsregisteret mates inn i eksisterende ovnsmodell (`Oven`), så effektprofil og billigste tidspunkt virker uendret |
| Lagring | `DataRepository` med localStorage og Supabase | Utvidet med utstyr og virksomhetstype |
| Database | Organisasjoner, roller, RLS, plangrenser, prøveperiode, import, eksport | Tabellen `equipment` fantes, men var ubrukt. Den utvides i stedet for å lage en ny |
| Oppskrifter | Bakeverketype, antall stk, steg, ovnsoppsett i `energy` (JSON) | Utstyrsvalg lagres i samme `energy`-felt, uten ny tabell |
| Skanning | Tesseract (OCR) og strekkoder i nettleseren | Uendret i fase 1 |

## 2. Faser

| Fase | Innhold | Status |
|---|---|---|
| 1 | Virksomhetstyper, utstyrsregister, matoppskrifter og porsjonsberegning | Godkjent. Branch `fase-1-matkalkulator` er pushet, ikke publisert |
| 2 | Personalkostnader, driftskostnader (fordeling av kjøl/frys/ventilasjon), allergener, menykalkulasjon. I tillegg underoppskrifter og arbeidstid fra punkt 4 | Godkjent. Branch `fase-2-matkalkulator` er pushet, ikke publisert |
| 3 | PWA (finnes delvis), egen Skann-side, strekkode med Open Food Facts-data, OCR og AI-skanning (Claude Haiku 5.5 i Supabase Edge Function med kvoter) | **Ferdig på branch `fase-3-matkalkulator`, venter på godkjenning** |
| 4 | Leverandører og prishistorikk, lagerstyring, matsvinn (inkl. svinn i oppskrifter), Business-abonnementer, dashboard | Ikke startet |

## 3. Fase 1 – levert

### Virksomhetstype (punkt 2)
- Ny kolonne `organizations.business_type`: privat, bakeri, restaurant, kafé, catering, kantine, matprodusent, annet.
- Eksisterende kunder: private kontoer får «privat», bedrifter får «bakeri». Ingen data endres ellers.
- Registreringen har valget «Virksomhetstype». Selvregistrering og 30 dagers Pro-prøve er som før.
- Eier og administrator kan endre virksomhetstype under **Innstillinger → Virksomhet**. Databasen hindrer at en bedrift blir «privat» og omvendt.
- Meny, ord og standardvalg tilpasses: bakerier og privatpersoner beholder «Bakekalkulator» og «Bakehistorikk». Andre får «Kalkulator», «Produksjonshistorikk», porsjoner som standard og ingen sammenligning med butikkpris. Mobilmenyen og oversikten tilpasses også.
- Nytt visningsnavn: **Rett i lomma – Matkalkulator** (fanetittel, app-ikon på hjemskjermen, innlogging). Domene, repository og Worker-navn er uendret.

### Utstyrsregister (punkt 3)
- Nytt menypunkt **Utstyr** med 16 utstyrstyper og ferdige maler. Malverdiene er merket «Anslag» til kunden har kontrollert dem.
- Felt per enhet: navn, type, produsent, modell, effekt (W eller kW), forvarmingstid, effektandel under forvarming og normal drift, normal brukstid, målt forbruk, kapasitet per produksjon, kommentar.
- Kjøleskap, fryser og ventilasjon merkes «Går hele tiden». De vises med forbruk og kostnad per måned, men velges ikke i oppskrifter. Fordelingen på produkter kommer med driftskostnadene i fase 2.
- I oppskrifter og kalkulatoren velger man **Manuelt oppsett** (som før) eller **Utstyr fra registeret**. Med registeret teller bare det valgte utstyret, og samme enhet regnes én gang, med forvarming én gang. Slik unngås dobbeltberegning.
- Kapasitet per omgang gir forslag til antall omganger.
- Endres en enhet i registeret, oppdateres oppskriftene som bruker den. Slettes den, beholder oppskriftene siste kjente verdier.

### Matoppskrifter og porsjoner (punkt 4, del 1)
- 14 kategorier, fra «Brød og bakervarer» til «Annet», med filter i oppskriftslisten. Eksisterende oppskrifter får kategori ut fra bakeverketype.
- Antall i stk eller porsjoner, tilberedningstid, steke-/koketid og temperatur, og ferdig vekt.
- Kostnad per porsjon/stk og per kilo (når ferdig vekt er oppgitt), og vekt per porsjon. Skalering som før.
- Flere typer utstyr per oppskrift.

### Utsatt fra punkt 4 til senere faser
| Krav | Fase | Begrunnelse |
|---|---|---|
| Underoppskrifter (saus, pizzadeig, dressing) og sperre mot sirkulære referanser | 2 | Henger sammen med menykalkulasjon og allergener, som må regne gjennom underoppskrifter |
| Arbeidstid | 2 | Del av personalkostnader |
| Råvaresvinn og tilberedningssvinn | 4 | Del av matsvinn |
| Bilder | 3 | Krever Supabase Storage med tilgangsstyring, som også trengs for skanning |

## 3b. Fase 2 – levert

### Allergener (punkt 7)
- Hver ingrediens har de 14 merkepliktige allergenene med «Inneholder», «Kan inneholde spor», «Inneholder ikke» eller «Ukjent». Eksisterende ingredienser får «Ukjent» for alle.
- Oppskrifter og retter får beregnet allergenstatus fra ingrediensene og underoppskriftene: inneholder, spor, risiko for krysskontakt (krysses av per oppskrift), ukjent eller inneholder ikke.
- «Inneholder ikke» vises bare når alle ingrediensene er kontrollert for allergenet. Mangler en opplysning, blir status «Ukjent».
- Feltet `allergens_checked` er klart for AI og skanning i fase 3: forslag som ikke er kontrollert, gir en tydelig advarsel helt ut til menyen.
- Menyene har en utskriftsvennlig allergenoversikt (rett × allergen).

### Underoppskrifter og arbeidstid (punkt 4, del 2)
- En oppskriftslinje kan være en ingrediens eller en annen oppskrift (saus, pizzadeig, dressing). Mengden oppgis i g/kg (andel av ferdig vekt) eller stk/porsjoner.
- Råvarer, strøm, arbeidstid og allergener regnes gjennom alle ledd.
- Sirkulære referanser stoppes i listen, i beregningen og i databasen (trigger som følger alle ledd).
- Arbeidstid per oppskrift: rolle × antall personer × minutter. Emballasje per stk/porsjon.

### Personalkostnader (punkt 8) og driftskostnader
- Ny side **Personal og drift** (skjult for privatpersoner). Eier og administrator endrer, alle medlemmer ser.
- Roller med detaljert beregning (timelønn, feriepenger, pensjon, arbeidsgiveravgift, andre personalkostnader) eller ferdig timekostnad. Alle satser kan endres. Forslagene (14,1 % AGA, 12 % feriepenger, 2 % OTP) er merket som forslag.
- Personalkostnaden fordeles på antall stk/porsjoner i oppskriften.
- Faste driftskostnader per måned og strøm til kjøl, frys og ventilasjon fra utstyrsregisteret fordeles på oppgitt produksjon per måned.

### Menykalkulasjon (punkt 9, så langt teksten rekker)
- Ny side **Menyer** med typene frokost, lunsj, middag, dagens rett, catering, sesong og egen.
- Per rett: råvarer, energi, personal, emballasje, fordelte driftskostnader, total kostnad, pris eks. mva, fortjeneste, margin og råvareandel. Mva 15 % eller 25 % per rett.
- Prisforslag ut fra ønsket margin.
- **Svinnkostnad** vises ikke ennå. Den kommer med matsvinn i fase 4. Resten av punkt 9 mangler i spesifikasjonen.

### Utelatt eller forenklet i fase 2
| Hva | Hvorfor |
|---|---|
| Svinnkostnad i menyer | Hører til matsvinn (fase 4) |
| Import av lokale personal-/driftskostnader og menyer | Lokale data har bare én bruker. Arbeidstid i oppskrifter importeres ikke, fordi rollene ikke følger med |
| Plan-/abonnementsgrenser for menyer | Avklares med Business-abonnementene i fase 4. Foreløpig maks 200 menyer per organisasjon |

## 3c. Fase 3 – levert

### Skann-siden (punkt 6)
- Nytt menypunkt **Skann** med fire valg: skann ingrediens, skann oppskrift, skann kvittering eller leverandørfaktura, og last opp bilde (galleri i stedet for kamera). Snarvei i mobilmenyen og fra app-ikonet (manifest-snarveier).
- **Ingrediens:** strekkode (BarcodeDetector, ZXing som reserve) slås opp i Open Food Facts med navn, produsent, pakning, ingrediensliste og allergener. Med AI kan etiketten tolkes. Allergener fra databasen eller AI merkes «ikke kontrollert». Manglende vare, opptatt tjeneste og manuell registrering er håndtert. Prisen legges alltid inn av brukeren.
- **Oppskrift:** tekstgjenkjenning på telefonen eller AI. Navn, ingredienser, mengder, enheter, antall (stk/porsjoner), tilberedningstid, steketid, temperatur og steg vises i redigerbart skjema.
- **Kvittering/faktura:** leverandør, dato, varer, antall, pakning, pris per pakning etter rabatt. Varene kobles til eksisterende ingredienser, nåværende pris vises ved siden av ny, og brukeren godkjenner hver endring. Historiske kostnader endres ikke.

### AI og kostnadskontroll
- Supabase Edge Function `ai-scan`. Ingen nøkler i frontend. Krever innlogging og medlemskap.
- Standardmodell Claude Haiku 5.5 (`claude-haiku-5-5`, 0,10/0,50 USD per million tokens). Modell, priser, kostnadstak, hastighetsgrense, bildestørrelse og kvoter endres under **Administrasjon → AI-skanning**.
- Kvoter per måned: Free 3, Plus 30, Pro 200. Håndheves i databasen med lås, også ved samtidige forespørsler. Feilede skanninger teller ikke. Strekkoder og tekstgjenkjenning teller ikke.
- Faktisk tokenforbruk og kostnad registreres per skanning (`ai_usage`), uten innhold.
- Strukturert utdata med fast JSON-skjema, og svaret valideres og renses på serveren. Teksten i bildet behandles som data, ikke som instruksjoner.
- Bildet komprimeres i nettleseren før opplasting (maks 1600 px, ca. 1,4 MB) og lagres ikke. Ingen logging av innhold.
- AI er av til systemadministrator slår den på og setter et kostnadstak.

### Ikke med i fase 3
| Hva | Hvorfor |
|---|---|
| Kvoter for Business og Business Plus (500 og 1 000) | Planene finnes ikke ennå, og kommer i fase 4 |
| Lagring av kvitteringer og bilder | Krever aktivt valg fra kunden og Supabase Storage. Avklares sammen med bilder i oppskrifter |
| Bilder i oppskrifter | Krever Supabase Storage med tilgangsstyring. Foreslås flyttet til fase 4 |
| Live videostrøm for strekkode | Bilde av strekkoden virker på alle telefoner og PC-er. Live kamera kan legges til senere |

## 4. Database – migrasjon 5

Fil: `supabase/migrations/20261127120000_matkalkulator_fase1.sql`. **Ikke kjørt mot produksjon.**

- Bare nye kolonner med standardverdier eller utfylling. Ingenting slettes eller døpes om.
- `handle_new_user`, `get_my_context` og `save_recipe` erstattes med utvidede versjoner. Eldre klienter som ikke sender de nye feltene, får standardverdier.
- Ny RPC `save_equipment` (security invoker, medlemskap sjekkes, RLS gjelder). Maks 500 enheter per organisasjon.
- Kolonnerettigheter: klienten kan bare oppdatere de nye, redigerbare kolonnene.

### Rekkefølge ved publisering
1. Kjør migrasjonen (`supabase db push` eller SQL Editor).
2. Publiser frontend.

Frontend tåler at migrasjonen mangler ved innlasting (virksomhetstype faller tilbake til standard). Lagring av utstyr og virksomhetstype krever migrasjonen.

## 4b. Database – migrasjon 6 (fase 2)

Fil: `supabase/migrations/20261128120000_matkalkulator_fase2.sql`. **Ikke kjørt mot produksjon.** Krever migrasjon 5.

- `ingredients.allergens` (jsonb, validert) og `allergens_checked`.
- `recipes.labor` (jsonb, validert), `packaging_per_unit`, `cross_contact` (text[], validert).
- `recipe_ingredients.sub_recipe_id` med sammensatt fremmednøkkel (samme organisasjon), sperre mot både ingrediens og underoppskrift på samme linje, og trigger mot sirkulære referanser.
- Ny tabell `cost_settings` (én rad per organisasjon, RLS: medlemmer leser, `save_cost_settings` krever eier/admin).
- Ny tabell `menus` (RLS: medlemmer, `save_menu`, maks 200).
- `save_ingredient`, `save_recipe`, `export_my_data` og `import_local_data` erstattes med utvidede versjoner. Eldre klienter som ikke sender de nye feltene, beholder lagrede verdier.
- Frontend leser `recipe_ingredients!recipe_id(*)`, fordi det nå finnes to fremmednøkler mellom tabellene.

## 4c. Database – migrasjon 7 (fase 3)

Fil: `supabase/migrations/20261129120000_matkalkulator_fase3.sql`. **Ikke kjørt mot produksjon.** Krever migrasjon 5 og 6.

- `ai_settings` (én rad, bare service_role og admin-funksjoner). `enabled = false` og kostnadstak 0 som standard.
- `plan_features.ai_scans_per_month` (Free 3, Plus 30, Pro 200), som også følger med i `get_my_context`.
- `ai_usage` med status, modell, tokens og kostnad. Medlemmer leser egen organisasjon. Bruker-id tas ikke med i eksporten.
- `reserve_ai_scan` / `finish_ai_scan` kan bare kjøres av service_role (Edge Function).
- `get_ai_status` for appen, og `admin_get_ai_settings`, `admin_set_ai_settings` og `admin_set_ai_quota` for systemadministrator.

I tillegg: hemmeligheter og publisering av Edge Function (se README, «AI-skanning»).

## 5. Testing i fase 1

- `npm test`: 313 tester (49 nye) – energi med registerutstyr, dobbeltberegning, målt forbruk, kontinuerlig drift, porsjoner/kilopris, mappers og databasetester for virksomhetstype, utstyr (RLS mellom kunder, roller, ugyldige verdier, eksport) og oppskrifter.
- `npm run test:pg`: 11 tester mot ekte PostgreSQL er grønne. `authFlow.supabase.test.ts` krever lokal Supabase og feiler likt på `main`.
- `npm run lint` og `npm run build` er grønne.

## 5b. Testing i fase 2

- `npm test`: 361 tester (48 nye). Allergener (ukjent er aldri «fri», spor, krysskontakt, gjennom underoppskrifter), underoppskrifter (andel, sirkler), timekostnad, driftskostnader, full kostnad per porsjon, menyer, mappers og bakoverkompatibilitet. Databasetester for RLS mellom kunder, roller, validering, sirkulære referanser, eksport og import.
- `npm run test:pg`: 11 grønne. `authFlow.supabase.test.ts` krever lokal Supabase (som før).
- `npm run lint` og `npm run build` er grønne.

## 5c. Testing i fase 3

- `npm test`: 395 tester (34 nye). Databasetester for standardoppsett, tilgang (bare admin, bare service_role), medlemskap, kvote, pågående reservasjoner, hastighetsgrense, kostnadstak, kostnadsberegning og eksport. Enhetstester for validering av AI-svar, forespørsler, skjemaer, omforming til skjemaene, Open Food Facts med allergener og feil, og bildekomprimering. Røyktest for Skann-siden.
- Edge Function er typesjekket mot Anthropic SDK 1.8.0 og supabase-js. Den er ikke kjørt mot Anthropic, fordi det krever API-nøkkel og koster penger.
- `npm run lint` og `npm run build` er grønne.

## 6. Åpne spørsmål

1. Hele teksten for punkt 9–20 mangler.
2. Pris, brukergrense og kvoter for Business og Business Plus (fase 4).
3. Skal brukerveiledningen (`veiledning.docx`/`.pdf`) oppdateres etter hver fase eller samlet til slutt?
4. Resten av punkt 9 (menykalkulasjon) og punkt for driftskostnader mangler i teksten. Fase 2 bygger på det som står og på overskriftene i fasene.
