# Rett i lomma – Bakekalkulator

Webapplikasjon som beregner hva hjemmebakst faktisk koster i strøm og ingredienser. Den finner også billigste tidspunkt å bake, sammenligner med butikkpris og regner på salg og fortjeneste.

Bygd med React 19, Vite, TypeScript, lucide-react og Supabase (Auth + PostgreSQL med RLS). Grensesnittet er på norsk (bokmål) og klargjort for flere språk og valutaer.

## Kom i gang

```bash
npm install
npm run dev        # utviklingsserver på http://localhost:5173
npm test           # enhetstester (Vitest)
npm run lint       # ESLint
npm run build      # typesjekk + produksjonsbygg til dist/
npm run preview    # forhåndsvis produksjonsbygget
```

Krever Node 20 eller nyere. Appen starter med eksempeldata (oppskrift på tre grovbrød, ti ingredienser og tre historiske bakinger), så den kan demonstreres med en gang. Under **Innstillinger** kan du slette eller laste inn eksempeldataene på nytt.

## Publisering (Cloudflare)

Appen kjører på **https://bakekalkulator.rettilomma.com** som en Cloudflare Worker med Static Assets. Den har ingen serverkode, bare statiske filer.

```bash
npm run deploy   # bygger med .env.local og publiserer (cf deploy)
```

- Oppsettet ligger i `cloudflare.config.ts` (Worker-navn, SPA-håndtering og domenet `bakekalkulator.rettilomma.com`, som Cloudflare lager DNS og SSL for).
- `VITE_SUPABASE_URL` og den offentlige nøkkelen bakes inn i JavaScript-filen ved bygg. Bare den offentlige nøkkelen skal ligge i `.env.local`.
- Kjør `npx cf auth login` første gang. Bruk prosjektets `cf` (`npm run deploy` / `npx cf`), ikke en eldre global versjon.
- Byggeresultatet (`.cloudflare/`) er ignorert av git.

## Funksjoner

| Side | Innhold |
|---|---|
| Oversikt | Strømpris nå, billigste bakevindu, gjeldende kalkyle, totalstatistikk, prisgraf og siste bakinger |
| Bakekalkulator | Ovn, forvarming, steking, omganger, kjøkkenmaskin, annet utstyr og målt forbruk. Kostnad per del, ingredienser, resultatkort og «bak flere samtidig» |
| Strømpriser | Kundetype (bedrift/privat), prisområde NO1–NO5, avtaletype (spot, Norgespris for privat, fastpris, manuell), graf, prisoppbygging og konfigurerbare tillegg |
| Mine oppskrifter | Opprette, redigere, kopiere og slette. Ingredienser, fremgangsmåte, hevetid, steketid, butikkpris og skalering |
| Ingredienser | Register med kategori, pakning, enhet, pris, butikk og prisdato |
| Bakehistorikk | Lagrede bakinger som øyeblikksbilder, med statistikk for uke, måned og år |
| Salg og fortjeneste | Kostnader, svinn, arbeid, mva, margin, påslag og anbefalt pris |
| Innstillinger | Bakefrekvens, reservepris, språk/valuta, eksport/import og tilbakestilling |

## Arkitektur

```
src/
  types/        Datamodeller (TypeScript-typer for alt som lagres)
  utils/        Ren beregningslogikk – ingen React. Testes isolert.
    energy.ts       strømforbruk og ovnens effektprofil
    electricity.ts  prisoppbygging, mva, strømstøtte, billigste tidspunkt
    costs.ts        ingredienskostnad, skalering, besparelse, batch
    units.ts        enhetskonvertering (g/kg, ml/dl/l, stk)
    sales.ts        fortjeneste, margin, påslag, anbefalt pris
    stats.ts        historikkstatistikk per periode
    bake.ts         samler alt for én baking
    format.ts       Intl-basert tall-, valuta- og datoformatering
  services/
    priceApi.ts     henting fra hvakosterstrommen.no med feilhåndtering og cache
    storage/        datalagringslaget (DataRepository, LocalStorage- og SupabaseRepository, mappers)
    auth.ts         registrering, innlogging, passord (Supabase Auth)
    importLocal.ts  import av lokale data uten duplikater
  context/      DataProvider (data + handlinger) og PricesProvider (felles prisdata)
  hooks/        useData, usePrices, usePriceData, useBakeResult, useRoute
  components/   Layout, UI-komponenter, PriceChart, PriceSettingsForm, ResultCards
  pages/        Én fil per menyvalg
  locales/      Oversettelser (nb.ts) og translate()
  lib/          Standardverdier, offentlige satser (tariffs.ts), eksempeldata, Supabase-klient, planer
  test/         PGlite-oppsett og databasetester (RLS, roller, prøveperioder …)
supabase/
  migrations/   SQL-migrasjoner (skjema, funksjoner, RLS, referansedata)
  config.toml   Lokal Supabase-konfigurasjon
```

**Prinsipper**

- Beregningslogikken i `utils/` er rene funksjoner uten UI-avhengigheter.
- Brukergrensesnittet snakker bare med `DataRepository`. Å bytte fra localStorage til Supabase betyr å skrive én ny klasse, uten å endre sidene.
- Oppdateringer er optimistiske og rulles tilbake hvis lagringen feiler.
- Ruting er hash-basert (`#/kalkulator`), så appen fungerer på statisk hosting uten serveroppsett.

### Klargjort for videre utvikling

| Område | Status |
|---|---|
| Supabase Auth, PostgreSQL og RLS | **Implementert** – se «Supabase-backend». |
| Gratis/Plus/Pro + Stripe | Planer og prøveperiode håndheves i databasen. Stripe er ikke koblet på (felt for kunde-/abonnements-id finnes i `subscriptions`). |
| Flere språk og valutaer | `locales/` med typede nøkler. Locale og valuta ligger i innstillingene og brukes av all formatering. |
| PWA | `public/manifest.webmanifest` og theme-color er på plass. Service worker gjenstår. |
| Cloudflare | `npm run build` gir et statisk `dist/` som kan deployes direkte til Cloudflare Pages/Workers Static Assets. Hash-ruting gjør at det ikke trengs redirect-regler. |

## Supabase-backend

Uten innlogging fungerer appen som før, med alt lagret lokalt i nettleseren. Innloggede brukere lagrer i Supabase (PostgreSQL), med Row Level Security på alle tabeller.

### Oppsett

1. Kopier `.env.example` til `.env.local` og fyll inn **Project URL** og den **offentlige** nøkkelen (publishable `sb_publishable_…` eller legacy `anon`) fra *Project Settings → API*.
   - `.env.local` er ignorert av git (`*.local`).
   - **Aldri** service_role- eller secret-nøkler i frontend. Alt med `VITE_`-prefiks havner i nettleseren. Klienten avviser slike nøkler (`assertPublicKey`).
2. Kjør migrasjonene (se under). Det skal **ikke** gjøres før SQL-koden er godkjent.
3. Gjør de manuelle innstillingene i Supabase Dashboard.

Uten miljøvariablene kjører appen i ren lokal modus, uten innloggingsmeny.

### Migrasjoner

Ligger i `supabase/migrations/` og kjøres i rekkefølge:

| Fil | Innhold |
|---|---|
| `20261126120000_core_schema.sql` | Typer, tabeller, constraints, indekser, `updated_at`-triggere, sperre mot endring av historikk |
| `20261126120100_functions.sql` | Tilgangshjelpere, effektiv plan, registreringstrigger, plangrenser og serverfunksjoner (RPC) |
| `20261126120200_rls_policies.sql` | RLS på alle tabeller, policyer, kolonne- og funksjonsrettigheter |
| `20261126120300_reference_data.sql` | Planer (Free/Plus/Pro) og offentlige strømprissatser |

Kjøre mot det eksterne prosjektet (etter godkjenning):

```bash
supabase login
supabase link --project-ref <prosjekt-ref>
supabase db push          # kjører migrasjonene i rekkefølge
```

Alternativt limer du filene inn i SQL Editor, i rekkefølgen over.

Kjøre lokalt med Docker (påvirker ikke det eksterne prosjektet):

```bash
supabase start            # lokal stack; e-post havner i http://localhost:54324
supabase db reset         # kjører alle migrasjoner på nytt
```

### Databasestruktur

Alle kundedata tilhører en **organisasjon**. En privatperson får en egen privat organisasjon med seg selv som eier, mens en bedrift kan ha flere medlemmer.

| Tabell | Innhold |
|---|---|
| `profiles` | Navn, e-post, tidspunkt for godkjente vilkår (1:1 med `auth.users`) |
| `organizations` | Navn og type (`private`/`business`) |
| `organization_members` | Medlemskap med rolle `owner`/`admin`/`member` |
| `subscriptions` | `plan`, `status`, `trial_started_at`, `trial_ends_at`, `current_period_end`, felt klargjort for Stripe |
| `plan_features` | Grenser per plan (oppskrifter, ingredienser, brukere, salg) |
| `user_settings` | Språk, valuta, bakefrekvens, aktiv organisasjon |
| `electricity_settings` | Strømoppsett per organisasjon (JSON som tilsvarer `PriceSettings`) |
| `electricity_tariffs` | Offentlige satser med gyldighetsperiode, kilde og dato for siste verifisering |
| `ingredients`, `recipes`, `recipe_ingredients`, `equipment` | Kundens data (`organization_id`) |
| `baking_history` | Øyeblikksbilder av bakinger. Kan ikke endres |
| `system_admins` | Systemeiere. Styres kun fra serversiden |

Viktige constraints:

- UUID-primærnøkler og `created_at`/`updated_at` overalt.
- CHECK-regler på beløp, enheter og tekstlengder.
- **Sammensatte fremmednøkler** `(id, organization_id)`, så en oppskriftslinje eller historikkrad aldri kan peke på en annen kundes ingrediens eller oppskrift.
- `unique(organization_id, local_id)` hindrer duplikater ved import.
- Historikk er **uforanderlig**: ingen UPDATE-rettighet, og triggeren `prevent_history_update` avviser endringer, også fra serveren.
  - Eneste unntak er det fremmednøklene gjør ved sletting: `recipe_id` og `created_by` kan gå fra en verdi til NULL, aldri til en annen UUID.
  - Sletting av oppskrifter eller brukerkontoer blokkeres derfor ikke av eksisterende historikk.
  - Alle beløp er kopiert inn, så senere prisendringer påvirker ikke historikken.
- **Negative strømpriser** støttes. `price_per_kwh`, `electricity_cost`, `total_cost` og `cost_per_item` har ingen nedre grense, mens ingredienskostnad, kWh og antall fortsatt valideres. Beregningsmotoren klemmer ikke strømprisen til null: negativ spotpris gir negativ strømkostnad, strømstøtte gis ikke, og grafen tegner negative priser under nullinjen.
- **Ingen overlappende satser:** `EXCLUDE USING gist (code, coalesce(area,'*'), coalesce(customer_type,'*'), daterange(valid_from, valid_to, '[]'))` (krever `btree_gist`).
  - NULL i `valid_to` betyr ubestemt tid.
  - Generelle og spesifikke satser kan gjelde samtidig. Prioritering: område + kundetype > område > kundetype > generell (`resolve_electricity_tariff`, samme regel i appen).
  - Begrensningen håndheves via indeks og er trygg ved samtidige transaksjoner. Manuell verifisering: `supabase/tests/concurrent_tariff_overlap.sql`.
- **Aktiv organisasjon** (`user_settings.active_organization_id`) har en sammensatt fremmednøkkel mot `organization_members (organization_id, user_id)`.
  - Den kan bare peke på et gyldig medlemskap, også ved skriving fra serveren.
  - Fjernes medlemskapet eller organisasjonen, settes den til NULL, og triggeren `reassign_active_organization` velger brukerens eldste gjenværende medlemskap.

### Sikkerhet og RLS

| Tabell | Lese | Skrive |
|---|---|---|
| profiles | egen | eget navn (kolonnerettighet) |
| legal_documents / legal_acceptances | alle / egne | **ingen direkte**. Godkjenning via `accept_legal_document` (servertid) |
| organizations | medlemmer | navn: eier/admin |
| organization_members | medlemmer | **ingen direkte**. Kun via RPC med rollesjekk |
| subscriptions | medlemmer | **ingen**. Kun server/systemadmin |
| user_settings | egen | egen (aktiv organisasjon må være en der brukeren er medlem) |
| electricity_settings | medlemmer | eier/admin |
| ingredients, recipes, recipe_ingredients, equipment | medlemmer | medlemmer |
| baking_history | medlemmer | opprette: medlemmer; slette: egne eller eier/admin; **aldri endre** |
| plan_features, electricity_tariffs | alle (også anonyme) | ingen. Satser endres via admin-RPC |
| system_admins | ingen | ingen (kun SQL Editor/service role) |

- `anon` har ingen tilgang til kundedata.
- Alle `SECURITY DEFINER`-funksjoner har `set search_path = ''` og fullt kvalifiserte navn, og sjekker selv hvem som kaller dem.
- EXECUTE er fjernet fra `PUBLIC`/`anon` og gitt eksplisitt.
- Roller endres bare med `set_member_role`. Kun eier kan bruke den, og aldri på seg selv. Admin kan ikke fjerne eier eller andre administratorer, og siste eier kan ikke forlate organisasjonen.
- Systemadministrator er en egen, serverstyrt rolle (`system_admins`). Admin-funksjonene returnerer bare aggregater og abonnementsdata, ikke oppskrifter, ingredienser eller historikk. RLS gir heller ingen generell tilgang.

### Autentisering

- Registrering med navn, e-post, passord (minst 8 tegn, bokstaver og tall), kontotype (privatperson/bedrift), firmanavn og godkjenning av vilkår.
- **Atomisk opprettelse på serversiden:** triggeren `handle_new_user` på `auth.users` oppretter profil, organisasjon, eiermedlemskap, 30 dagers Pro-prøve, brukerinnstillinger og strømoppsett i samme transaksjon som brukeren. Feiler ett ledd, opprettes ingenting.
- E-postbekreftelse, innlogging, utlogging, glemt passord og tilbakestilling (`?auth=recovery`).
- Vedvarende sesjon (`persistSession`, automatisk fornyelse) og PKCE-flyt, slik at innloggingslenker bruker `?code=` og ikke kolliderer med hash-rutingen.
- Beskyttede sider: `#/konto`, `#/admin` og `#/salg` krever innlogging når Supabase er satt opp. Tilgang håndheves uansett i databasen.

### Abonnement

| Plan | Oppskrifter | Ingredienser | Brukere | Salg og fortjeneste |
|---|---|---|---|---|
| Free | 5 | 50 | 1 | – |
| Plus | 50 | 500 | 3 | ✓ |
| Pro | ubegrenset | ubegrenset | 25 | ✓ |

- Grensene ligger i `plan_features` og kan justeres uten kodeendring. `src/lib/plans.ts` brukes bare til visning.
- Nye kunder får **30 dager Pro** uten betalingskort.
- **Effektiv plan** (`effective_plan_internal`): aktivt betalt abonnement gir planen, aktiv prøve gir Pro, ellers gjelder Free. Prøveperioden går derfor automatisk over til Free, uten cron-jobb.
- `expire_trials()` merker utløpte prøver som `expired` for rapportering. Den kan kjøres med pg_cron.
- **Håndheves på serveren:** triggeren `enforce_plan_limits` stopper nye oppskrifter og ingredienser over grensen (transaksjonssikkert med lås per organisasjon), og salgsregistrering på Free. Eksisterende data slettes aldri, og kan alltid redigeres.
- Kunden kan ikke endre abonnementet selv. Systemadmin kan endre det manuelt (`admin_set_subscription`) inntil Stripe er på plass. Stripe er **ikke** implementert.

### Datalagring og import

- `DataRepository` har to implementasjoner: `LocalStorageRepository` (uten innlogging) og `SupabaseRepository` (innlogget, aktiv organisasjon). Sidene er de samme.
- Oppskrifter lagres atomisk med linjer via `save_recipe`.
- **Import av lokale data** (Konto → *Importer lokale data*):
  - Oppskrifter og ingredienser sendes med lokale id-er (`local_id`), og alt kjøres i én transaksjon (`import_local_data`).
  - Gjentatt import hopper over det som finnes, så det blir ingen duplikater.
  - Feiler importen, lagres ingenting.
  - Lokale data slettes **aldri** automatisk. Brukeren kan velge å slette dem etter en bekreftet vellykket import.
  - Bakehistorikk importeres ikke.

### Personvern

- **Eksport:** `export_my_data()` returnerer profil, innstillinger og alle data i organisasjonene brukeren er medlem av, som JSON.
- **Sletting av konto:** `delete_my_account('SLETT')` krever bekreftelse **og nylig innlogging** (se «Kontosletting og GDPR»).
  - Organisasjoner der brukeren er eneste medlem slettes med alle data.
  - I bedrifter med flere medlemmer overføres eierskapet til eldste administrator, eller eldste medlem hvis det ikke finnes noen. Organisasjonens data beholdes.
  - Til slutt slettes `auth.users`-raden, som også fjerner profilen.
- Utkast til **personvernerklæring** (`#/personvern`) og **brukervilkår** (`#/vilkar`) må fullføres før lansering.

### Offentlige strømprissatser

- `electricity_tariffs` har gyldig fra/til, kilde og dato for siste verifisering.
- Standardvalget i appen er *«Bruk gjeldende offentlige satser automatisk»*: Norgespris, strømstøtte og elavgift hentes for beregningsdatoen (`utils/tariffs.ts`).
- **Utløpte satser brukes aldri automatisk:**
  - Utløpt Norgespris gjør at manuell pris brukes.
  - Utløpt strømstøtte trekkes ikke fra.
  - Utløpt elavgift legges ikke til.
  - Brukeren får en advarsel i hvert tilfelle.
- Brukeren kan velge egne satser. Manuell totalpris er fortsatt tilgjengelig.
- Systemeier vedlikeholder satsene på admin-siden.
- Uten Supabase brukes en lokal kopi (`src/lib/tariffs.ts`), som er identisk med seed-dataene.

### Administrasjon

`#/admin` vises bare for brukere i `system_admins`. Den viser:

- antall kunder (privat/bedrift) og brukere
- aktive og utløpte prøveperioder og fordeling per plan
- abonnementsoversikt med manuell endring
- administrasjon av strømprissatser

### Transaksjonssikkerhet og integritet

- **Plangrenser ved samtidighet:** `enforce_plan_limits` (oppskrifter og ingredienser) og `add_member_by_email` (medlemmer) tar en transaksjonsbasert advisory lock per organisasjon (`lock_organization`) **før** de teller.
  - Samtidige transaksjoner må vente på hverandre og kan ikke passere grensen.
  - Triggeren gjelder alle innganger: REST, RPC og import.
  - Verifisert mot ekte PostgreSQL. En kontrolltest viser at grensen *blir* passert uten låsen.
- **Redigering ved nådd grense:** grensen gjelder bare **nye** rader. Rader som finnes fra før (samme `id`, eller samme `organization_id` + `local_id`) telles ikke.
  - `save_recipe` og `save_ingredient` oppdaterer eksisterende rader med UPDATE.
  - REST-upsert av en eksisterende rad blokkeres heller ikke.
  - Nedgradering fra Pro til Free sletter ingenting og hindrer ikke redigering.
- **Idempotent import:** `import_local_data` krever gyldig, ikke-tom `local_id` (maks 100 tegn).
  - Organisasjonen låses, og eksisterende data hoppes over *før* grensen kontrolleres. Gjentatt import fungerer derfor også når grensen er nådd.
  - Samtidige importer gir ingen duplikater.
  - Alt kjøres i én transaksjon.
- **Uforanderlige identitetsfelt:**
  - Klienten har UPDATE bare på redigerbare kolonner. `id`, `organization_id`, `created_by`, `created_at` og `local_id` kan ikke endres, og data kan ikke flyttes mellom organisasjoner.
  - Triggeren `protect_row_identity` håndhever det samme også for SECURITY DEFINER og service role. `created_by` kan bare bli NULL (ved sletting av bruker).
  - `set_insert_metadata` setter `created_by = auth.uid()` og `created_at = now()` ved opprettelse, så de kan ikke forfalskes.
  - `electricity_settings.updated_by` settes av serveren.
- **Medlemsadministrasjon:**
  - Alle medlemsfunksjoner sjekker tilgang før de slår opp data, låser organisasjonen og sjekker rollen på nytt etter låsen. Samtidige endringer kan derfor ikke gi en organisasjon uten eier.
  - `delete_my_account` låser alle brukerens organisasjoner i fast rekkefølge (stigende id), slik at det ikke oppstår deadlocks.
  - Sikkerhetsnett: `ensure_org_has_owner` forfremmer eldste administrator, eller eldste medlem, hvis siste eier forsvinner på annen måte, for eksempel ved sletting i Dashboard.

**Anbefaling – invitasjoner (ikke implementert, venter på godkjenning):** `add_member_by_email` legger en registrert bruker direkte til, og avslører for eier og admin om e-postadressen har konto. Anbefalt løsning:

1. Tabellen `organization_invitations` med `id`, `organization_id`, e-post (normalisert), rolle, `token_hash` (SHA-256), `invited_by`, `expires_at` (7 dager), `accepted_at` og `revoked_at`, og unik aktiv invitasjon per organisasjon og e-post.
2. `create_invitation(org, email, role)`: owner/admin, med plan- og medlemsgrense under lås. Returnerer alltid samme svar, uansett om e-posten har konto.
3. En e-post med engangslenke, sendt via en Edge Function med Supabase SMTP. Bare hashen av tokenet lagres.
4. `accept_invitation(token)`: mottakeren må være innlogget med *bekreftet* e-post som matcher invitasjonen. Plan- og medlemsgrensen kontrolleres på nytt under lås før medlemskapet opprettes.
5. `revoke_invitation` og `list_invitations` for owner/admin. Utløpte invitasjoner ryddes med pg_cron.

### Kontosletting og GDPR

- `delete_my_account('SLETT')` krever i tillegg **nylig innlogging**. Serveren leser `amr`-claimet i JWT-en, som Supabase Auth signerer og som inneholder tidspunktet for faktisk innlogging. Det må være høyst 10 minutter gammelt. Appen ber om passord og logger inn på nytt rett før sletting.
- Hvis brukeren er eneste medlem, slettes den private organisasjonen og alle data. Eier av en bedrift med flere medlemmer får eierskapet overført, og bedriftens data beholdes.
- `created_by` i felles data og historikk settes til NULL. Snapshots inneholder bare beregningsdata (ingredienslinjer, pris og energi) og ingen personopplysninger. Fritekst (navn på baksten og notat) kan inneholde det brukeren selv skriver.
- **Eksisterende tilgangstoken etter sletting:** JWT-en er teknisk gyldig til den utløper (standard 1 time), men gir ingen tilgang. Medlemskap og profil er slettet, så RLS returnerer ingenting, og skriving feiler. Supabase Auth sletter samtidig brukerens refresh-tokens.
- **Godkjenninger:**
  - `legal_acceptances` lagrer én rad per dokument (vilkår og personvern) og versjon, med servertid.
  - Gjeldende versjoner ligger i `legal_documents`.
  - Klienten kan bare lese dem. Ny godkjenning går via `accept_legal_document`.
  - Ved registrering sender klienten bare versjonsnumre. Tidspunkter fra klienten brukes aldri.

### Databaseprivilegier

- REVOKE og GRANT gjelder bare Bakekalkulatorens egne tabeller og funksjoner, ramset opp eksplisitt.
- PUBLIC har ingen tabellrettigheter og ingen EXECUTE på egne funksjoner.
- Interne funksjoner (`lock_organization`, `effective_plan_internal`, `recently_authenticated` og triggerfunksjonene) kan ikke kalles av klienter.
- **Fremtidige objekter:** standardrettighetene for anon og authenticated på nye tabeller, sekvenser og funksjoner i `public` er fjernet. EXECUTE for PUBLIC er fjernet globalt for rollen som kjører migrasjonene, fordi PostgreSQL ikke tillater å fjerne den per skjema. Det er akseptabelt fordi prosjektet er dedikert. Nye objekter må derfor få rettigheter eksplisitt.

### Import – dekning

| Data | Importeres | Kommentar |
|---|---|---|
| Ingredienser | ✓ | Idempotent via `local_id` |
| Oppskrifter med linjer og ovnsoppsett | ✓ | Ovnsoppsett og utstyr per oppskrift følger med i `energy` |
| Bakehistorikk | – | **Mangler.** Kan legges til med `local_id` på `baking_history` og plansjekk for salg |
| Utstyrsregister (`equipment`) | – | Lokal app har ikke eget utstyrsregister. Utstyr ligger i oppskriftenes `energy` |
| Innstillinger (strømoppsett, bakefrekvens) | – | **Mangler.** Bevisst ikke overskrevet, fordi strømoppsettet er felles for organisasjonen |

### E-post (Resend og norske maler)

E-post sendes via Resend fra `noreply@rettilomma.com` (Authentication → Emails → SMTP Settings: host `smtp.resend.com`, port `465`, brukernavn `resend`, passord = Resend API-nøkkel). Nøkkelen legges kun inn i Dashboard – aldri i koden.

Norske maler ligger i `supabase/templates/` og brukes automatisk lokalt (`config.toml`). For det eksterne prosjektet limes de inn under **Authentication → Emails → Templates**:

| Mal i Dashboard | Emne | Fil |
|---|---|---|
| Confirm signup | `Bekreft e-postadressen din – Rett i lomma` | `confirmation.html` |
| Reset password | `Tilbakestill passordet ditt – Rett i lomma` | `recovery.html` |
| Change email address | `Bekreft ny e-postadresse – Rett i lomma` | `email_change.html` |

Malene bruker Supabase-variablene `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .NewEmail }}`, `{{ .SiteURL }}` og navnet fra registreringen (`{{ .Data.full_name }}`, utelates hvis det mangler).

### Manuelle innstillinger i Supabase Dashboard

1. **Authentication → Sign In / Providers → Email:** *Confirm email* på.
2. **Authentication → URL Configuration:**
   - *Site URL* = produksjonsadressen.
   - *Redirect URLs*: `http://localhost:5173/?auth=confirmed`, `http://localhost:5173/?auth=recovery` og tilsvarende for produksjon.
3. **Authentication → Policies/Passwords:** minimum 8 tegn, «letters and digits». Slå på *leaked password protection* hvis planen har det.
4. **Authentication → Emails:** egen SMTP før lansering (innebygd e-post har lav kvote) og norske e-postmaler.
5. **Systemadministrator** (SQL Editor):
   ```sql
   insert into public.system_admins (user_id, note)
   select id, 'Systemeier' from auth.users where email = '<din e-post>';
   ```
6. *(Valgfritt)* **pg_cron** for rapportering av utløpte prøver:
   ```sql
   select cron.schedule('expire-trials', '15 2 * * *', 'select public.expire_trials()');
   ```
7. Kontroller **Database → Advisors** (security og performance) etter at migrasjonene er kjørt.
8. **Slett brukere via appen** (`delete_my_account`), ikke i Dashboard. Sletting i Dashboard overfører eierskap (sikkerhetsnett), men fjerner ikke private organisasjoner som blir stående uten medlemmer.
9. Vurder kortere **JWT expiry** (Authentication → Sessions). Det begrenser hvor lenge et token er teknisk gyldig etter utlogging eller sletting.

## Beregningsmetoder

### Strømforbruk

```
Energi (kWh) = effekt (W) / 1000 × tid (timer) × effektfaktor
```

- **Forvarming** beregnes **én gang**: ovnseffekt × forvarmingstid × forvarmingseffekt (standard 100 %).
- **Steking**: ovnseffekt × steketid × snitteffekt (termostaten slår av og på, typisk 40–70 %) × antall omganger.
- **Kjøkkenmaskin** og **annet utstyr** beregnes med samme formel.
- **Målt forbruk** erstatter estimatet når det er slått på. Kostnaden fordeles da proporsjonalt på delene.

### Strømpris per kWh

Spotpriser hentes fra `https://www.hvakosterstrommen.no/api/v1/prices/YYYY/MM-DD_NOx.json`. Prisene er **eks. mva**. Intervallets lengde leses fra dataene, så både timespriser og kvarterspriser støttes.

For å unngå dobbel beregning:

1. Hver komponent (energi, påslag, nettleie, elavgift, andre avgifter) har et eget flagg for om satsen er oppgitt inkl. mva. Alle regnes om til beløp **eks. mva**.
2. Mva legges på **én gang**, på summen.
3. Elavgift kan merkes som «inkludert i nettleien» og legges da ikke til separat.
4. Strømstøtte (bare spot) = `max(0, spot − terskel) × dekningsgrad × (1 + mva)` og trekkes fra.
5. **Norgespris**: fast energipris, uten påslag og strømstøtte.

**Kundetype.** Standard er **Bedrift**. Bedrifter har ikke Norgespris eller strømstøtte. De valgene skjules i grensesnittet og ignoreres også i beregningen (Norgespris faller tilbake til spot). Mva-fritaket i Nord-Norge gjelder bare husholdninger, så en bedrift i NO4 får 25 % mva. Valget «Mva-registrert bedrift» er på som standard. Da legges ikke mva på, og mva trekkes ut av satser som er oppgitt inkl. mva, slik at kostnaden blir eks. mva. Med **Privat** regnes prisen inkl. mva. Strømstøtte slås på automatisk, fordi husholdninger får den uten å søke, og Norgespris kan velges.
6. **Manuell pris** brukes som den er, uten tillegg.

Prisoppbyggingen vises på siden Strømpriser, med tydelig markering av hva som er inkludert og ikke.

**Satser.** Satsene er kontrollert mot primærkildene (Lovdata og Stortinget) 26.11.2026. Foreslåtte 2027-satser er ikke registrert. Satser uten `verified_at` brukes aldri automatisk. Alle kan endres av brukeren:

| Sats | Standard | Merknad |
|---|---|---|
| Mva | 25 % (0 % i NO4) | Store deler av Nord-Norge er fritatt |
| Norgespris | 40 øre/kWh eks. mva | [Forskrift om Norgespris § 10](https://lovdata.no/dokument/SF/forskrift/2025-09-08-1790), 1.10.2025–31.12.2026. Ingen sats fastsatt for 2027 |
| Strømstøtte | 90 % over 77 øre/kWh eks. mva | [Forskrift om strømstønad § 5](https://lovdata.no/dokument/SF/forskrift/2025-09-08-1791), 2026. Ikke sammen med Norgespris |
| Elavgift | 7,13 øre/kWh eks. mva | [Stortingets vedtak for 2026](https://www.stortinget.no/no/Saker-og-publikasjoner/Vedtak/Vedtak/Sak/?did=40035803&p=104911). Husholdninger i tiltakssonen (Finnmark og Karlsøy, Kvænangen, Kåfjord, Lyngen, Nordreisa, Skjervøy, Storfjord) er fritatt |
| Nettleie | Ingen standard | Varierer per nettselskap og må legges inn av brukeren |

Hvis spotprisen mangler, faller kalkulatoren tilbake til dagens snitt og deretter til reserveprisen fra Innstillinger. Brukeren får beskjed når dette skjer.

### Billigste tidspunkt

Ovnens effektprofil er forvarming (høy effekt) etterfulgt av alle stekeomgangene (snitteffekt). For hver kandidat-starttid (start på hvert prisintervall, fra nå og fremover) integreres `effekt × pris` over alle intervallene profilen overlapper, også delvise intervaller. Vinduer som går utenfor kjente priser forkastes. Det billigste vinduet vises i grafen. Hvis morgendagens priser ikke er publisert (vanligvis rundt kl. 13), brukes bare prisene som er kjent.

### Ingredienser

```
kostnad = (mengde omregnet til pakningens enhet / pakningsstørrelse) × pakningspris
```

Eksempel: 2 kg mel koster 32 kr, oppskriften bruker 750 g → 0,75 / 2 × 32 = **12 kr**.

Omregning skjer bare innen samme dimensjon (g↔kg, ml↔dl↔l). Volum↔vekt krever kjent tetthet og blir **ikke** regnet om. Slike linjer markeres i stedet som «kan ikke beregnes».

### Skalering

`skaleringsfaktor = ønsket antall / oppskriftens antall`. Faktoren brukes på alle ingrediensmengder.

### Resultater og besparelse

- Total bakekostnad = strømkostnad + ingredienskostnad
- Kostnad per stk = total / antall
- Besparelse per baking = (butikkpris − egen kostnad per stk) × antall. Per måned = × bakinger per måned. Per år = × 12.
- **Bak flere samtidig**: ovnens strøm deles på flere bakervarer, mens ingredienser og kjøkkenmaskin skaleres. Forutsetter at ovnen har plass.

### Salg

- Total kostnad = ingredienser + strøm + emballasje × antall + arbeidstimer × timepris + transport + andre kostnader
- Solgte enheter = produsert × (1 − svinn)
- Omsetning eks. mva = pris eks. mva × solgte enheter
- **Fortjenestemargin** = fortjeneste / omsetning
- **Påslag** = fortjeneste / kostnad
- **Anbefalt pris** eks. mva = kostnad per solgte enhet / (1 − ønsket margin)

### Historikk

Hver baking lagres som et **øyeblikksbilde** med kopierte verdier (kWh, pris, kostnader). Senere endringer i ingredienspriser eller strømpris påvirker derfor ikke historikken. Det finnes en egen test for dette.

## Tester

| Kommando | Kjører | Krever |
|---|---|---|
| `npm test` | 198 tester: enhet, komponent og **PGlite**-databasetester (de ekte migrasjonene i Postgres i minnet) | Ingenting |
| `npm run test:pg` | 11 tester mot **ekte PostgreSQL**: samtidige transaksjoner, låser og deadlocks | Lokal PostgreSQL (initdb), eller `PG_TEST_URL` |

`npm run test:pg` starter en midlertidig, isolert klynge (initdb i temp-mappe, port 54329, kun 127.0.0.1) og sletter den etterpå. Med `PG_TEST_URL` kan testene i stedet kjøres mot lokal Supabase (`postgresql://postgres:postgres@localhost:54322/postgres`). Pek aldri mot produksjon, siden testene lager og sletter egne databaser.

| Fil | Dekker |
|---|---|
| `src/utils/__tests__/calculations.test.ts` | Strømforbruk, strømkostnader, enheter, ingredienskostnad, skalering, kostnad per stk, fortjeneste, margin, billigste tidspunkt |
| `src/utils/__tests__/tariffs.test.ts` | Datostyrte satser, utløpte satser, manuelle satser |
| `src/utils/__tests__/negative.test.ts` | Negative strømpriser i beregning, billigste tidspunkt, salg og lagring |
| `src/services/__tests__/services.test.ts` | Strømpris-API, lokal lagring, uendret historikk |
| `src/services/__tests__/auth.test.ts` | Registrering, innlogging, utlogging, glemt/tilbakestill passord, avvisning av hemmelige nøkler |
| `src/services/__tests__/cloud.test.ts` | Prøveperioder, import, mapping mot databasen, feilmeldinger |
| `src/services/__tests__/round3.test.ts` | Ny innlogging før sletting, godkjenninger, import-id, ikke-verifiserte satser |
| `src/test/db.test.ts` | PGlite: registrering, profiler, roller, RLS og kundeisolasjon, prøveperioder, import, historikk, satser, admin, personvern |
| `src/test/db.corrections.test.ts` | PGlite: negative priser, historikk ved sletting, overlappende satser, aktiv organisasjon |
| `src/test/db.security.test.ts` | PGlite: redigering ved grense, nedgradering, idempotent import, flytting av data, forfalskning av `created_by`/`updated_by`, informasjonslekkasje, kontosletting uten ny innlogging, token etter sletting, godkjenninger, privilegier, referansedata. «Direkte REST» simuleres med SQL som `authenticated`, slik PostgREST gjør |
| `tests/pg/concurrency.test.ts` | Ekte PostgreSQL: samtidig opprettelse ved grensen (oppskrifter, ingredienser, medlemmer), redigering under samtidighet, samtidig import, samtidig degradering, utmelding og sletting av eiere, deadlocks, og en kontrolltest uten lås |
| `src/__tests__/app.smoke.test.tsx` | Alle sider rendres i lokal modus |
