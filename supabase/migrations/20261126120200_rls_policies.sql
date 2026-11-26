-- =====================================================================
-- Migrasjon 3/4: Row Level Security, policyer og rettigheter
--
-- Modell:
--  * anon: kan kun lese offentlige satser, planer og dokumentversjoner.
--  * authenticated: tilgang til egne data og data i organisasjoner der
--    brukeren er medlem. UPDATE kun på redigerbare kolonner – id,
--    organization_id, created_by, created_at og local_id kan ikke endres.
--  * Roller, abonnement, godkjenninger og systemadmin kan ikke endres fra klienten.
--  * service_role (kun server) omgår RLS – brukes aldri i frontend.
--
-- Alle REVOKE/GRANT under gjelder kun Bakekalkulatorens egne objekter.
-- =====================================================================

-- ---------- Fremtidige objekter: ingen automatiske rettigheter ----------
-- Supabase gir som standard anon/authenticated tilgang til nye tabeller og
-- funksjoner i public. Det slås av for objekter opprettet av rollen som kjører
-- migrasjonene, slik at nye objekter må få rettigheter eksplisitt.
-- MERK: EXECUTE for PUBLIC på nye funksjoner er en global standard i PostgreSQL og
-- kan ikke fjernes per skjema – den fjernes derfor globalt for rollen som kjører
-- migrasjonene (prosjektet er dedikert til Bakekalkulatoren).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges revoke execute on functions from public;

-- ---------- Slå på RLS ----------
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.system_admins enable row level security;
alter table public.legal_documents enable row level security;
alter table public.legal_acceptances enable row level security;
alter table public.plan_features enable row level security;
alter table public.subscriptions enable row level security;
alter table public.user_settings enable row level security;
alter table public.electricity_settings enable row level security;
alter table public.electricity_tariffs enable row level security;
alter table public.ingredients enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.equipment enable row level security;
alter table public.baking_history enable row level security;

-- ---------- Tabellrettigheter (kun egne tabeller) ----------
revoke all on table
  public.profiles, public.organizations, public.organization_members, public.system_admins,
  public.legal_documents, public.legal_acceptances, public.plan_features, public.subscriptions,
  public.user_settings, public.electricity_settings, public.electricity_tariffs,
  public.ingredients, public.recipes, public.recipe_ingredients, public.equipment, public.baking_history
from public, anon, authenticated;

grant select on public.plan_features, public.electricity_tariffs, public.legal_documents to anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

grant select on public.legal_acceptances to authenticated; -- endres aldri av klienten

grant select on public.organizations to authenticated;
grant update (name) on public.organizations to authenticated;

grant select on public.organization_members to authenticated; -- endres kun via RPC
grant select on public.subscriptions to authenticated;         -- endres kun på serversiden

grant select, insert on public.user_settings to authenticated;
grant update (active_organization_id, locale, currency, bakes_per_month) on public.user_settings to authenticated;

grant select on public.electricity_settings to authenticated;
grant update (settings) on public.electricity_settings to authenticated; -- updated_by settes av trigger

grant select, insert, delete on public.ingredients, public.recipes, public.recipe_ingredients, public.equipment to authenticated;
grant update (name, category, package_size, unit, price, store, price_updated) on public.ingredients to authenticated;
grant update (name, type, yield_count, steps, rise_minutes, bake_minutes, store_price_per_item, notes, energy) on public.recipes to authenticated;
grant update (ingredient_id, position, amount, unit) on public.recipe_ingredients to authenticated;
grant update (name, watt, minutes, power_factor_percent) on public.equipment to authenticated;

grant select, insert, delete on public.baking_history to authenticated; -- ingen update: øyeblikksbilder
-- system_admins: ingen rettigheter for klienter.

-- ---------- profiles ----------
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------- legal ----------
create policy legal_documents_read on public.legal_documents
  for select to anon, authenticated using (true);
create policy legal_acceptances_select_own on public.legal_acceptances
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------- organizations ----------
create policy organizations_select_member on public.organizations
  for select to authenticated using (public.is_org_member(id));
create policy organizations_update_admin on public.organizations
  for update to authenticated
  using (public.has_org_role(id, array['owner', 'admin']::public.organization_role[]))
  with check (public.has_org_role(id, array['owner', 'admin']::public.organization_role[]));

-- ---------- organization_members (kun lesing; endringer via RPC) ----------
create policy members_select_same_org on public.organization_members
  for select to authenticated using (public.is_org_member(organization_id));

-- ---------- plan_features / electricity_tariffs (offentlig lesing) ----------
create policy plan_features_read on public.plan_features
  for select to anon, authenticated using (true);
create policy tariffs_read on public.electricity_tariffs
  for select to anon, authenticated using (true);

-- ---------- subscriptions (kun lesing for medlemmer) ----------
create policy subscriptions_select_member on public.subscriptions
  for select to authenticated using (public.is_org_member(organization_id));

-- ---------- user_settings ----------
create policy user_settings_select_own on public.user_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy user_settings_insert_own on public.user_settings
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (active_organization_id is null or public.is_org_member(active_organization_id)));
create policy user_settings_update_own on public.user_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (active_organization_id is null or public.is_org_member(active_organization_id)));

-- ---------- electricity_settings (eier/admin endrer, alle medlemmer leser) ----------
create policy electricity_settings_select_member on public.electricity_settings
  for select to authenticated using (public.is_org_member(organization_id));
create policy electricity_settings_update_admin on public.electricity_settings
  for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]));

-- ---------- Kundedata: medlemmer av organisasjonen ----------
create policy ingredients_member_all on public.ingredients
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy recipes_member_all on public.recipes
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- Sammensatte fremmednøkler sikrer i tillegg at oppskrift og ingrediens tilhører samme organisasjon.
create policy recipe_ingredients_member_all on public.recipe_ingredients
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy equipment_member_all on public.equipment
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy history_select_member on public.baking_history
  for select to authenticated using (public.is_org_member(organization_id));
create policy history_insert_member on public.baking_history
  for insert to authenticated
  with check (public.is_org_member(organization_id) and created_by = (select auth.uid()));
create policy history_delete_own_or_admin on public.baking_history
  for delete to authenticated
  using (
    public.is_org_member(organization_id)
    and (created_by = (select auth.uid()) or public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]))
  );

-- ---------- Funksjonsrettigheter (kun egne funksjoner) ----------
revoke execute on function
  public.set_updated_at(),
  public.prevent_history_update(),
  public.protect_row_identity(),
  public.set_insert_metadata(),
  public.set_updated_by(),
  public.lock_organization(uuid),
  public.is_org_member(uuid),
  public.has_org_role(uuid, public.organization_role[]),
  public.is_system_admin(),
  public.recently_authenticated(interval),
  public.effective_plan_internal(uuid),
  public.effective_plan(uuid),
  public.handle_new_user(),
  public.accept_legal_document(text, text),
  public.enforce_plan_limits(),
  public.expire_trials(),
  public.get_my_context(),
  public.list_organization_members(uuid),
  public.add_member_by_email(uuid, text, public.organization_role),
  public.set_member_role(uuid, uuid, public.organization_role),
  public.remove_member(uuid, uuid),
  public.leave_organization(uuid),
  public.ensure_org_has_owner(),
  public.reassign_active_organization(),
  public.delete_my_account(text),
  public.export_my_data(),
  public.save_recipe(uuid, jsonb, jsonb),
  public.save_ingredient(uuid, jsonb),
  public.import_local_data(uuid, jsonb),
  public.resolve_electricity_tariff(text, date, text, text),
  public.active_electricity_tariffs(date),
  public.admin_overview(),
  public.admin_list_subscriptions(integer, integer),
  public.admin_set_subscription(uuid, public.subscription_plan, public.subscription_status, timestamptz),
  public.admin_upsert_tariff(jsonb),
  public.admin_delete_tariff(uuid)
from public, anon, authenticated;

-- Brukes i RLS-policyer og av klienten (returnerer kun informasjon om kalleren selv)
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.organization_role[]) to authenticated;
grant execute on function public.is_system_admin() to authenticated;
grant execute on function public.effective_plan(uuid) to authenticated;

-- Klient-RPC (SECURITY DEFINER-funksjonene sjekker kalleren selv)
grant execute on function public.get_my_context() to authenticated;
grant execute on function public.accept_legal_document(text, text) to authenticated;
grant execute on function public.list_organization_members(uuid) to authenticated;
grant execute on function public.add_member_by_email(uuid, text, public.organization_role) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, public.organization_role) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.leave_organization(uuid) to authenticated;
grant execute on function public.delete_my_account(text) to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.save_recipe(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.save_ingredient(uuid, jsonb) to authenticated;
grant execute on function public.import_local_data(uuid, jsonb) to authenticated;
grant execute on function public.resolve_electricity_tariff(text, date, text, text) to anon, authenticated;
grant execute on function public.active_electricity_tariffs(date) to anon, authenticated;

-- Systemadmin-RPC (sjekker is_system_admin() internt)
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_list_subscriptions(integer, integer) to authenticated;
grant execute on function public.admin_set_subscription(uuid, public.subscription_plan, public.subscription_status, timestamptz) to authenticated;
grant execute on function public.admin_upsert_tariff(jsonb) to authenticated;
grant execute on function public.admin_delete_tariff(uuid) to authenticated;

-- Kun server (pg_cron / service_role)
grant execute on function public.expire_trials() to service_role;

-- Ikke kjørbare for klienter: lock_organization, recently_authenticated,
-- effective_plan_internal og triggerfunksjonene. De brukes kun internt av
-- SECURITY DEFINER-funksjoner og triggere.
