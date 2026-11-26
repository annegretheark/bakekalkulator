# Rett i lomma – Bakekalkulator

Webapplikasjon som beregner hva hjemmebakst faktisk koster i strøm og ingredienser. Den finner også billigste tidspunkt å bake, sammenligner med butikkpris og regner på salg og fortjeneste.

Bygd med React 19, Vite, TypeScript og lucide-react. Grensesnittet er på norsk (bokmål) og klargjort for flere språk og valutaer.

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
    storage/        datalagringslaget (DataRepository + LocalStorageRepository)
  context/      DataProvider (data + handlinger) og PricesProvider (felles prisdata)
  hooks/        useData, usePrices, usePriceData, useBakeResult, useRoute
  components/   Layout, UI-komponenter, PriceChart, PriceSettingsForm, ResultCards
  pages/        Én fil per menyvalg
  locales/      Oversettelser (nb.ts) og translate()
  lib/          Standardverdier og satser, eksempeldata, Supabase-klient, abonnementsplaner
```

**Prinsipper**

- Beregningslogikken i `utils/` er rene funksjoner uten UI-avhengigheter.
- Brukergrensesnittet snakker bare med `DataRepository`. Å bytte fra localStorage til Supabase betyr å skrive én ny klasse, uten å endre sidene.
- Oppdateringer er optimistiske og rulles tilbake hvis lagringen feiler.
- Ruting er hash-basert (`#/kalkulator`), så appen fungerer på statisk hosting uten serveroppsett.

### Klargjort for videre utvikling

| Område | Status |
|---|---|
| Supabase Auth / selvregistrering | `lib/supabase.ts` lager klienten når `VITE_SUPABASE_URL` og `VITE_SUPABASE_ANON_KEY` er satt (se `.env.example`). Ingen tabeller eller innlogging er laget. |
| PostgreSQL + RLS | `DataRepository` tilsvarer tabellene `settings`, `ingredients`, `recipes` og `bake_logs`. Hver tabell får `user_id` og policyen `auth.uid() = user_id`. Alle modeller er serialiserbare og har `id`. |
| Gratis/Pro + Stripe | `lib/plans.ts` har planer og grenser (håndheves ikke ennå). `settings.plan` lagres allerede. |
| Flere språk og valutaer | `locales/` med typede nøkler. Locale og valuta ligger i innstillingene og brukes av all formatering. |
| PWA | `public/manifest.webmanifest` og theme-color er på plass. Service worker gjenstår. |
| Cloudflare | `npm run build` gir et statisk `dist/` som kan deployes direkte til Cloudflare Pages/Workers Static Assets. Hash-ruting gjør at det ikke trengs redirect-regler. |

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

**Satser.** Standardverdiene i `lib/defaults.ts` (`RATE_REFERENCES`) ble kontrollert 26.11.2026 og har kildelenker. Alle kan endres av brukeren:

| Sats | Standard | Merknad |
|---|---|---|
| Mva | 25 % (0 % i NO4) | Store deler av Nord-Norge er fritatt |
| Norgespris | 40 øre/kWh eks. mva | Gjelder t.o.m. 31.12.2026. 45 øre er foreslått for 2027 |
| Strømstøtte | 90 % over 77 øre/kWh eks. mva | Av som standard. Ikke sammen med Norgespris |
| Elavgift | 7,13 øre/kWh eks. mva | Av som standard, ofte inkludert i nettleien |
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

`npm test` kjører Vitest:

- `src/utils/__tests__/calculations.test.ts`: strømforbruk, strømkostnader (mva, elavgift, strømstøtte, Norgespris, manuell), enhetskonvertering, ingredienskostnad, skalering, kostnad per stk, besparelse, batch, fortjeneste, margin, påslag, anbefalt pris og billigste tidspunkt (time- og kvarterspriser)
- `src/services/__tests__/services.test.ts`: API-URL og parsing, eksempeldata, uendret historikk ved prisendring og robusthet mot ødelagte data
- `src/__tests__/app.smoke.test.tsx`: rendrer alle sider i jsdom med mocket strømpris-API
