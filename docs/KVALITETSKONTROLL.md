# Kvalitetskontroll – Rett i lomma – Matkalkulator

Dato: 27.11.2026. Kontrollert mot `KRAVSPESIFIKASJON.md` (fasene 1–4) og punkt 1–9 i den innlimte spesifikasjonen. Punkt 10–20 finnes ikke i noen av filene og er derfor ikke kontrollert.

## Status for produksjon

**Fase 1–4 er allerede publisert.** Etter godkjenning tidligere 27.11.2026 er migrasjon 5–9 kjørt, Edge Function `ai-scan` er publisert, `main` er publisert til Cloudflare og AI-skanning er slått på. Under denne kontrollen er ingenting pushet, og ingen migrasjoner er kjørt.

## Resultat av kontrollene

| Kontroll | Resultat |
|---|---|
| TypeScript (`tsc`, app og node) | Ingen feil |
| ESLint | Ingen feil |
| `npm test` (Vitest, 24 filer) | **442 bestått, 0 feilet** |
| `npm run test:pg` (ekte PostgreSQL) | **11 bestått, 0 feilet**. 1 testfil hoppet over: `authFlow.supabase.test.ts` krever lokal Supabase (`supabase start`), som før |
| `npm run build` | OK (advarsel om JS-pakke på 777 kB, 220 kB komprimert) |

## Feil funnet og rettet i kontrollen

| Feil | Konsekvens i produksjon | Rettelse |
|---|---|---|
| Lagring av leverandør brukte `upsert`, som krever oppdateringsrett på `id` og `organization_id`. Klienten har med vilje ikke denne retten | **Kan ikke opprette eller endre leverandører i produksjon nå** | Oppdater først, opprett hvis den ikke finnes. Nye databasetester gjør de samme kallene som appen. Committet lokalt, **ikke pushet** |
| (Rettet og publisert tidligere i dag) Innlasting av oppskrifter feilet fordi det finnes to koblinger mellom `recipes` og `recipe_ingredients` | Oppskrifter lastet ikke | Hintet bruker navnet på fremmednøkkelen |

Begge feilene skyldes at databasetestene kjører SQL direkte og ikke går gjennom Supabase-API-et (PostgREST). Se anbefalinger.

## 1. Ferdig implementert

| Område | Status | Kontrollert med |
|---|---|---|
| Selvregistrering for alle virksomhetstyper | Ferdig. Privat, bakeri, restaurant, kafé, catering, kantine, matprodusent og annet. 30 dager Pro uten godkjenning. Ugyldig type gir «annet» | Databasetester (`handle_new_user`), røyktest |
| Utstyrsregister og energi | Ferdig. 16 typer med maler (merket «Anslag»), W/kW, forvarming, målt forbruk, kapasitet, kontinuerlig drift. Registermodus hindrer dobbelttelling | Enhetstester for energi, databasetester for utstyr |
| Oppskrifter og porsjoner | Ferdig. 14 kategorier, stk/porsjoner, tider, ferdig vekt, kostnad per porsjon og kilo, skalering, underoppskrifter med sperre mot sirkler (app og database), arbeidstid, emballasje, svinn | Enhets- og databasetester |
| Menykalkulasjon og lønnsomhet | Ferdig. 7 menytyper. Per rett: råvarer, energi, personal, svinn, emballasje, drift, pris eks. mva, fortjeneste, margin, råvareandel. Prisforslag | Enhetstester, visuell kontroll |
| Personal- og driftskostnader | Ferdig. Detaljert eller ferdig timekostnad. Faste kostnader og kontinuerlig utstyr fordeles på produksjon per måned. Bare eier/admin endrer | Enhets- og databasetester |
| Allergener | Ferdig. 14 kategorier, inneholder/spor/krysskontakt/ukjent/fri. Aldri «fri» ved manglende data. AI- og databaseopplysninger merkes «ikke kontrollert». Utskriftsvennlig oversikt | Enhetstester, visuell kontroll av utskrift |
| Lager og matsvinn | Ferdig (Business). Beholdning, verdi, minimum, innkjøp/uttak/telling, automatisk uttak fra produksjon, svinnregistrering med kostnad på dagen | Enhets- og databasetester |
| Leverandører og innkjøpspriser | Ferdig. Register, innkjøpsfelt, automatisk prishistorikk, sammenligning (flere leverandører: Business). Historiske kostnader endres ikke | Enhets- og databasetester (+ rettelsen over) |
| Mobil og PWA | Ferdig. Manifest med snarveier, service worker, frakoblet-varsel, mobilmeny med Skann | Visuell kontroll på 390 px, ingen horisontal rulling |
| Skanning | Ferdig. Skann-side med fire valg. Strekkode (BarcodeDetector/ZXing) med Open Food Facts og allergener, OCR på telefonen, AI via Edge Function med kvote, hastighetsgrense, kostnadstak og forbruksregistrering | Enhets- og databasetester, Edge Function typesjekket og røyktestet i produksjon (avviser uinnlogget) |
| Abonnementer og prøveperiode | Ferdig. Free/Plus/Pro uendret, nye Business (50 brukere, 500 AI) og Business Plus (200 brukere, 1 000 AI). Grenser og funksjoner håndheves i databasen | Databasetester |
| RLS og isolasjon mellom kunder | Ferdig for alle nye tabeller. Tester for at andre kunder ikke kan lese, endre eller slette | 4 nye databasetestfiler (fase 1–4) i tillegg til eksisterende |
| Eksisterende bakefunksjonalitet | Uendret for bakerier og privatpersoner (Bakekalkulator, Bakehistorikk, butikkpris, flere ovner, strømpriser, salg) | Eksisterende 270+ tester, røyktest for alle sider |

## 2. Mangler eller er forenklet

| Hva | Kommentar |
|---|---|
| Punkt 10–20 i kravspesifikasjonen | Teksten finnes ikke i `KRAVSPESIFIKASJON.md` eller i det innlimte dokumentet. Kan ikke kontrolleres |
| Bilder i oppskrifter (punkt 4) | Ikke implementert. Krever Supabase Storage med tilgangsstyring |
| Valgfri lagring av kvitteringer (punkt 6) | Ikke implementert. Bilder lagres aldri, som er i tråd med «unngå permanente kopier» |
| Live videostrøm for strekkode | Strekkoden leses fra et bilde. Virker på alle enheter |
| Betaling (Stripe) og priser i appen | Ikke implementert. Planer settes manuelt av systemadministrator |
| Prøveperiode for Business | Ny bedrift får Pro-prøve. Business må settes manuelt |
| Import av lokale data | Leverandører, lager, svinn, menyer og personal-/driftskostnader importeres ikke (bare oppskrifter og ingredienser) |
| Kvitteringslinjer rett inn på lager | Innkjøp registreres på lagersiden |
| Tester mot Supabase-API-et | Finnes ikke. Det var derfor de to produksjonsfeilene over slapp gjennom |

## 3. Tester

- Vitest: **442 bestått, 0 feilet** (24 filer). Herav ca. 190 nye i fase 1–4 og kontrollen.
- PostgreSQL (`test:pg`): **11 bestått, 0 feilet**. `authFlow.supabase.test.ts` kjøres ikke uten lokal Supabase.

## 4. SQL-migrasjoner

| Migrasjon | Status i produksjon |
|---|---|
| `20261127120000_matkalkulator_fase1.sql` | Kjørt |
| `20261128120000_matkalkulator_fase2.sql` | Kjørt |
| `20261129120000_matkalkulator_fase3.sql` | Kjørt |
| `20261130120000_business_planer.sql` | Kjørt |
| `20261130120100_matkalkulator_fase4.sql` | Kjørt |

Ingen nye migrasjoner trengs for rettelsene i denne kontrollen. Anbefalt (ikke laget): tak på antall leverandører, og at `org_has_feature` bare svarer for egne organisasjoner (se punkt 6).

## 5. API-nøkler og miljøvariabler

| Hvor | Navn | Status |
|---|---|---|
| Frontend (`.env.local`, Cloudflare build) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (bare offentlig nøkkel) | Satt |
| Supabase Edge Function-hemmeligheter | `ANTHROPIC_API_KEY` | Satt |
| Supabase Edge Function-hemmeligheter | `ALLOWED_ORIGINS` (valgfri, standard er bakekalkulator.rettilomma.com og localhost:5173) | Ikke satt (standard brukes) |
| Settes automatisk av Supabase | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Automatisk |
| Administrasjon → AI-skanning | AI på, kostnadstak, modell (`claude-haiku-5-5`), priser, kvoter | Slått på |

## 6. Sikkerhet

Ingen kritiske funn. Kontrollert: RLS på alle nye tabeller, sammensatte fremmednøkler (ingen kobling mellom kunder), kolonnerettigheter, SECURITY DEFINER-funksjoner (alle sjekker medlemskap, rolle og plan og har `search_path = ''`), Edge Function (JWT, medlemskap, kvote under lås, ingen logging av innhold, validering av AI-svar, CORS), ingen hemmeligheter i frontend.

| Funn | Alvorlighet | Anbefaling |
|---|---|---|
| Timelønn i personalkostnader kan leses av alle medlemmer i organisasjonen (trengs for å regne kostnad) | Lav / personvern | Vurder om det er akseptabelt. Alternativt: bare ferdig timekostnad synlig for medlemmer |
| `org_has_feature(org, …)` svarer også for organisasjoner brukeren ikke er medlem av (avslører om en ukjent organisasjons-id har Business) | Lav (krever gjetting av UUID) | Legg inn medlemskapskontroll i en senere migrasjon |
| Ingen grense for antall leverandører eller lagerbevegelser per organisasjon | Lav (misbruk/lagringsvekst) | Tak, slik som for utstyr (500) og menyer (200) |
| Medlemmer ser hvem i organisasjonen som har brukt AI-skanning (`ai_usage.user_id`) | Lav | Akseptabelt internt. Ikke med i eksport |
| Gamle versjoner av appen i nettleseren kan miste underoppskriftslinjer ved lagring | Lav | Brukere bør laste siden på nytt etter publisering |

## 7. Før neste publisering

1. **Push rettelsen for leverandører til `main`.** Uten den kan kundene ikke lagre leverandører i produksjon.
2. Kontroller i produksjon som innlogget bruker: åpne oppskrift, ingrediens med priser, lagre leverandør, personal og drift, meny og AI-skanning.
3. Vurder tester mot Supabase-API-et (lokal `supabase start` i CI) slik at feil i koblinger og rettigheter fanges før publisering.
4. Avklar punkt 10–20 i spesifikasjonen, og om bilder, Stripe og lagring av kvitteringer skal med.
