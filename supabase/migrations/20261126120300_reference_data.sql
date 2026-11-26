-- =====================================================================
-- Migrasjon 4/4: Referansedata (planer, dokumentversjoner og offentlige satser)
--
-- Offentlige satser er kontrollert mot primærkildene 2026-11-26 (verified_at).
-- Kun vedtatte satser registreres – foreslåtte satser for 2027 (Norgespris 45 øre,
-- strømstønad-terskel 79 øre) er IKKE lagt inn. Utløpte satser brukes ikke
-- automatisk (se active_electricity_tariffs / resolve_electricity_tariff).
-- =====================================================================

-- Abonnementsgrenser (uendret inntil annet er bestemt)
insert into public.plan_features (plan, max_recipes, max_ingredients, max_members, sales_calculator) values
  ('free', 5, 50, 1, false),
  ('plus', 50, 500, 3, true),
  ('pro', null, null, 25, true)
on conflict (plan) do update set
  max_recipes = excluded.max_recipes, max_ingredients = excluded.max_ingredients,
  max_members = excluded.max_members, sales_calculator = excluded.sales_calculator;

-- Dokumentversjoner. Utkast – må erstattes med endelige versjoner før lansering.
insert into public.legal_documents (document, version, url, is_current) values
  ('terms', '2026-11-26-utkast', '#/vilkar', true),
  ('privacy', '2026-11-26-utkast', '#/personvern', true)
on conflict (document, version) do nothing;

insert into public.electricity_tariffs (code, description, value, unit, area, customer_type, valid_from, valid_to, source_url, verified_at, notes) values
  -- Forskrift om Norgespris (FOR-2025-09-08-1790) § 10: referansepris 40 øre/kWh eks. mva
  -- for 1. oktober 2025 – 31. desember 2026. § 13: inntil 5 000 kWh/mnd (husholdning),
  -- 1 000 kWh/mnd (fritidsbolig). Ingen pris er fastsatt for 2027.
  ('norgespris', 'Norgespris (referansepris for husholdninger)', 0.40, 'kr/kWh eks. mva', null, 'privat',
   '2025-10-01', '2026-12-31',
   'https://lovdata.no/dokument/SF/forskrift/2025-09-08-1790',
   '2026-11-26', '§ 10. Gjelder husholdning og fritidsbolig. Forbrukstak § 13: 5 000 kWh/mnd (husholdning), 1 000 kWh/mnd (fritidsbolig).'),
  -- Forskrift om strømstønad (FOR-2025-09-08-1791) § 5: for forbruk 1.1.–31.12.2026
  -- terskelverdi 77 øre/kWh eks. mva og stønadsgrad 90 prosent, første 5 000 kWh/mnd.
  ('stromstotte_terskel', 'Strømstøtte – terskelverdi', 0.77, 'kr/kWh eks. mva', null, 'privat',
   '2026-01-01', '2026-12-31',
   'https://lovdata.no/dokument/SF/forskrift/2025-09-08-1791',
   '2026-11-26', '§ 5. Første 5 000 kWh per måned per målepunkt. Ikke sammen med Norgespris. Ingen verdi fastsatt for 2027.'),
  ('stromstotte_dekning', 'Strømstøtte – stønadsgrad', 90, 'prosent', null, 'privat',
   '2026-01-01', '2026-12-31',
   'https://lovdata.no/dokument/SF/forskrift/2025-09-08-1791',
   '2026-11-26', '§ 5. Andel av spotpris over terskelverdien som dekkes.'),
  -- Stortingets vedtak om avgift på elektrisk kraft for 2026 (vedtak 225, Innst. 3 S (2025–2026)):
  -- § 1: 7,13 øre/kWh fra 1. januar 2026; redusert sats 0,6 øre/kWh bl.a. i tiltakssonen.
  -- § 3 nr. 1: fritak for husholdninger og offentlig forvaltning i Finnmark og kommunene
  -- Karlsøy, Kvænangen, Kåfjord, Lyngen, Nordreisa, Skjervøy og Storfjord.
  -- Budsjettvedtaket gjelder budsjetterminen 2026 (derfor valid_to 31.12.2026).
  ('elavgift', 'Elavgift – alminnelig sats', 0.0713, 'kr/kWh eks. mva', null, null,
   '2026-01-01', '2026-12-31',
   'https://www.stortinget.no/no/Saker-og-publikasjoner/Vedtak/Vedtak/Sak/?did=40035803&p=104911',
   '2026-11-26', 'Fritak for husholdninger og offentlig forvaltning i tiltakssonen (Finnmark, Karlsøy, Kvænangen, Kåfjord, Lyngen, Nordreisa, Skjervøy og Storfjord). Annen bruk der: 0,6 øre/kWh. Tiltakssonen følger ikke prisområdene og må velges av brukeren.');
