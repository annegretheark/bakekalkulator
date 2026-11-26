-- Manuell test: overlappende satser ved SAMTIDIGE transaksjoner.
-- Kjøres mot en LOKAL database (supabase start), ikke produksjon.
-- PGlite i de automatiske testene har kun én tilkobling og kan ikke teste dette.
--
-- Åpne to psql-økter:  psql "postgresql://postgres:postgres@localhost:54322/postgres"
--
-- Økt A:
begin;
insert into public.electricity_tariffs (code, description, value, unit, valid_from, valid_to, source_url, verified_at)
values ('samtidig_test', 'A', 1, 'kr', '2030-01-01', '2030-12-31', 'https://example.com', current_date);
-- (ikke commit ennå)

-- Økt B (mens A er åpen) – blir stående og vente på A:
begin;
insert into public.electricity_tariffs (code, description, value, unit, valid_from, valid_to, source_url, verified_at)
values ('samtidig_test', 'B', 2, 'kr', '2030-06-01', null, 'https://example.com', current_date);

-- Økt A:
commit;

-- Forventet i økt B: ERROR 23P01 conflicting key value violates exclusion
-- constraint "electricity_tariffs_no_overlap". Kun én av satsene lagres.
-- (Ruller A tilbake i stedet, lykkes B.)

-- Opprydding:
rollback;  -- i økt B
delete from public.electricity_tariffs where code = 'samtidig_test';
