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
| 1 | Virksomhetstyper, utstyrsregister, matoppskrifter og porsjonsberegning | **Ferdig på branch `fase-1-matkalkulator`, venter på godkjenning** |
| 2 | Personalkostnader, driftskostnader (fordeling av kjøl/frys/ventilasjon), allergener, menykalkulasjon. I tillegg underoppskrifter og arbeidstid fra punkt 4 | Ikke startet |
| 3 | PWA (finnes delvis), egen Skann-side, strekkode med Open Food Facts-data, OCR og AI-skanning (Claude Haiku 5.5 i Supabase Edge Function med kvoter) | Ikke startet |
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

## 5. Testing i fase 1

- `npm test`: 313 tester (49 nye) – energi med registerutstyr, dobbeltberegning, målt forbruk, kontinuerlig drift, porsjoner/kilopris, mappers og databasetester for virksomhetstype, utstyr (RLS mellom kunder, roller, ugyldige verdier, eksport) og oppskrifter.
- `npm run test:pg`: 11 tester mot ekte PostgreSQL er grønne. `authFlow.supabase.test.ts` krever lokal Supabase og feiler likt på `main`.
- `npm run lint` og `npm run build` er grønne.

## 6. Åpne spørsmål

1. Hele teksten for punkt 9–20 mangler.
2. Pris, brukergrense og kvoter for Business og Business Plus (fase 4).
3. Skal brukerveiledningen (`veiledning.docx`/`.pdf`) oppdateres etter hver fase eller samlet til slutt?
