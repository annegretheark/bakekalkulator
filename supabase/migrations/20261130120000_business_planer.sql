-- =====================================================================
-- Rett i lomma – Matkalkulator
-- Migrasjon 8: Business-planer (fase 4, del 1)
--
-- Nye verdier i en enum må være lagret (commit) før de kan brukes, derfor
-- ligger dette i en egen migrasjon før 20261130120100_matkalkulator_fase4.sql.
-- Eksisterende abonnementer endres ikke.
-- =====================================================================
alter type public.subscription_plan add value if not exists 'business';
alter type public.subscription_plan add value if not exists 'business_plus';
