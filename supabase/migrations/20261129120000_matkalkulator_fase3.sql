-- =====================================================================
-- Rett i lomma – Matkalkulator
-- Migrasjon 7: Fase 3 – AI-skanning med kvoter og kostnadskontroll
--
--  * ai_settings: én rad. AI er AV til systemadministrator slår den på.
--    Modell, priser og kostnadstak kan endres uten ny kode.
--  * plan_features.ai_scans_per_month: kvote per plan (systemadmin endrer).
--  * ai_usage: én rad per AI-skanning med tokens og kostnad. Ingen bilder,
--    ingen tekst fra dokumentene og ingen resultater lagres.
--  * reserve_ai_scan / finish_ai_scan: kalles bare av Edge Function
--    (service_role). Kvote, hastighetsgrense og kostnadstak kontrolleres
--    med lås per organisasjon, så samtidige forespørsler ikke slipper forbi.
--  * Vanlig strekkodeskanning og tekstgjenkjenning på telefonen bruker ikke AI
--    og belaster ikke kvoten.
-- Krever migrasjon 5 og 6.
-- =====================================================================

-- ---------- Innstillinger (systemadministrator) ----------
create table public.ai_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  -- Standardmodell: Claude Haiku 5.5. Kan endres uten ny kode.
  model text not null default 'claude-haiku-5-5' check (model ~ '^[a-z0-9][a-z0-9.-]{2,80}$'),
  -- Listepris i USD per million tokens (for kostnadsregistrering)
  input_usd_per_mtok numeric(10, 4) not null default 0.10 check (input_usd_per_mtok >= 0),
  output_usd_per_mtok numeric(10, 4) not null default 0.50 check (output_usd_per_mtok >= 0),
  -- Samlet kostnadstak per kalendermåned for hele tjenesten (USD). 0 = AI stoppes.
  monthly_cost_limit_usd numeric(10, 2) not null default 0 check (monthly_cost_limit_usd >= 0),
  -- Antatt maks kostnad per skanning, brukt når reserverte skanninger regnes mot taket
  estimated_cost_per_scan_usd numeric(10, 4) not null default 0.01 check (estimated_cost_per_scan_usd >= 0),
  -- Hastighetsgrense per bruker
  max_scans_per_minute integer not null default 5 check (max_scans_per_minute between 1 and 100),
  -- Maks bildestørrelse etter komprimering (byte)
  max_image_bytes integer not null default 1500000 check (max_image_bytes between 50000 and 5000000),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.ai_settings (id) values (true);

create trigger set_updated_at before update on public.ai_settings for each row execute function public.set_updated_at();
create trigger set_updated_by before insert or update on public.ai_settings for each row execute function public.set_updated_by();

alter table public.ai_settings enable row level security;
revoke all on public.ai_settings from public, anon, authenticated;
-- Ingen policyer: bare service_role (Edge Function) og admin-RPC-ene under har tilgang
grant select on public.ai_settings to service_role;

-- ---------- Kvoter per plan ----------
alter table public.plan_features
  add column ai_scans_per_month integer not null default 0 check (ai_scans_per_month between 0 and 100000);
update public.plan_features set ai_scans_per_month = case plan
  when 'free' then 3
  when 'plus' then 30
  when 'pro' then 200
  else 0 end;

-- ---------- Forbruk ----------
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Brukeren slettes → raden beholdes for kostnadsoversikten, uten personkobling
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('oppskrift', 'kvittering', 'ingrediens')),
  status text not null default 'reservert' check (status in ('reservert', 'ok', 'feil')),
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  -- Kort feilkode (aldri dokumentinnhold)
  error_code text check (error_code is null or error_code ~ '^[A-Z_]{2,40}$'),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index ai_usage_org_month_idx on public.ai_usage (organization_id, created_at);
create index ai_usage_user_recent_idx on public.ai_usage (user_id, created_at);
create index ai_usage_month_idx on public.ai_usage (created_at);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from public, anon, authenticated;
grant select on public.ai_usage to authenticated;
-- Medlemmer ser organisasjonens forbruk (antall og kostnad), ikke andres
create policy ai_usage_select_member on public.ai_usage
  for select to authenticated using (public.is_org_member(organization_id));

-- Skanninger som teller mot kvoten: vellykkede og pågående (reserverte).
-- Feilede teller ikke. Reservasjoner eldre enn 10 minutter regnes som avbrutt.
create or replace function public.ai_scans_used(org uuid, since timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.ai_usage u
  where u.organization_id = org and u.created_at >= since
    and (u.status = 'ok' or (u.status = 'reservert' and u.created_at > now() - interval '10 minutes'));
$$;
revoke all on function public.ai_scans_used(uuid, timestamptz) from public, anon, authenticated;

-- ---------- Status for kunden (vises i appen) ----------
create or replace function public.get_ai_status(org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.ai_settings;
  v_month timestamptz := date_trunc('month', now());
  v_limit integer;
begin
  if not public.is_org_member(org) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  select * into s from public.ai_settings where id;
  select f.ai_scans_per_month into v_limit from public.plan_features f where f.plan = public.effective_plan_internal(org);
  return jsonb_build_object(
    'enabled', coalesce(s.enabled, false) and coalesce(s.monthly_cost_limit_usd, 0) > 0,
    'used', public.ai_scans_used(org, v_month),
    'limit', coalesce(v_limit, 0),
    'resets_at', v_month + interval '1 month'
  );
end;
$$;
revoke all on function public.get_ai_status(uuid) from public, anon;
grant execute on function public.get_ai_status(uuid) to authenticated;

-- ---------- Reservasjon (bare Edge Function / service_role) ----------
-- Returnerer id for forbruksraden, eller kaster en feil med kode:
--   AI_DISABLED, FORBIDDEN, QUOTA_EXCEEDED, RATE_LIMITED, COST_LIMIT
create or replace function public.reserve_ai_scan(org uuid, uid uuid, scan_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.ai_settings;
  v_month timestamptz := date_trunc('month', now());
  v_limit integer;
  v_used integer;
  v_recent integer;
  v_cost numeric;
  v_pending integer;
  v_id uuid;
begin
  if not exists (select 1 from public.organization_members m where m.organization_id = org and m.user_id = uid) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  select * into s from public.ai_settings where id;
  if not coalesce(s.enabled, false) or coalesce(s.monthly_cost_limit_usd, 0) <= 0 then
    raise exception using errcode = 'P0001', message = 'AI_DISABLED';
  end if;

  -- Én reservasjon om gangen per organisasjon (kvoten), og globalt for kostnadstaket
  perform public.lock_organization(org);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bakekalkulator.ai_cost', 0));

  select f.ai_scans_per_month into v_limit from public.plan_features f where f.plan = public.effective_plan_internal(org);
  v_used := public.ai_scans_used(org, v_month);
  if v_used >= coalesce(v_limit, 0) then
    raise exception using errcode = 'P0001', message = 'QUOTA_EXCEEDED';
  end if;

  select count(*) into v_recent from public.ai_usage u
   where u.user_id = uid and u.created_at > now() - interval '1 minute';
  if v_recent >= s.max_scans_per_minute then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED';
  end if;

  select coalesce(sum(u.cost_usd), 0),
         count(*) filter (where u.status = 'reservert' and u.created_at > now() - interval '10 minutes')
    into v_cost, v_pending
    from public.ai_usage u where u.created_at >= v_month;
  if v_cost + (v_pending + 1) * s.estimated_cost_per_scan_usd > s.monthly_cost_limit_usd then
    raise exception using errcode = 'P0001', message = 'COST_LIMIT';
  end if;

  insert into public.ai_usage (organization_id, user_id, kind, model)
  values (org, uid, scan_kind, s.model)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'model', s.model, 'max_image_bytes', s.max_image_bytes,
    'used', v_used + 1, 'limit', v_limit
  );
end;
$$;
revoke all on function public.reserve_ai_scan(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_ai_scan(uuid, uuid, text) to service_role;

-- Avslutter en reservasjon med faktisk forbruk. Kostnaden beregnes fra prisene i ai_settings.
create or replace function public.finish_ai_scan(usage_id uuid, ok boolean, in_tokens integer, out_tokens integer, err text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.ai_settings;
begin
  select * into s from public.ai_settings where id;
  update public.ai_usage set
    status = case when ok then 'ok' else 'feil' end,
    input_tokens = greatest(coalesce(in_tokens, 0), 0),
    output_tokens = greatest(coalesce(out_tokens, 0), 0),
    cost_usd = (greatest(coalesce(in_tokens, 0), 0) * s.input_usd_per_mtok
              + greatest(coalesce(out_tokens, 0), 0) * s.output_usd_per_mtok) / 1000000.0,
    error_code = case when ok then null else left(upper(coalesce(err, 'UKJENT')), 40) end,
    finished_at = now()
  where id = usage_id and status = 'reservert';
end;
$$;
revoke all on function public.finish_ai_scan(uuid, boolean, integer, integer, text) from public, anon, authenticated;
grant execute on function public.finish_ai_scan(uuid, boolean, integer, integer, text) to service_role;

-- ---------- Administrasjon (systemadministrator) ----------
create or replace function public.admin_get_ai_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month timestamptz := date_trunc('month', now());
begin
  if not public.is_system_admin() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' - 'updated_by' from public.ai_settings s where s.id),
    'quotas', (select coalesce(jsonb_object_agg(f.plan, f.ai_scans_per_month), '{}'::jsonb) from public.plan_features f),
    'month', jsonb_build_object(
      'scans', (select count(*) from public.ai_usage u where u.created_at >= v_month and u.status = 'ok'),
      'failed', (select count(*) from public.ai_usage u where u.created_at >= v_month and u.status = 'feil'),
      'input_tokens', (select coalesce(sum(u.input_tokens), 0) from public.ai_usage u where u.created_at >= v_month),
      'output_tokens', (select coalesce(sum(u.output_tokens), 0) from public.ai_usage u where u.created_at >= v_month),
      'cost_usd', (select coalesce(sum(u.cost_usd), 0) from public.ai_usage u where u.created_at >= v_month),
      'organizations', (select count(distinct u.organization_id) from public.ai_usage u where u.created_at >= v_month)
    )
  );
end;
$$;

create or replace function public.admin_set_ai_settings(settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_system_admin() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  update public.ai_settings s set
    enabled = coalesce((settings ->> 'enabled')::boolean, s.enabled),
    model = coalesce(nullif(btrim(settings ->> 'model'), ''), s.model),
    input_usd_per_mtok = coalesce((settings ->> 'input_usd_per_mtok')::numeric, s.input_usd_per_mtok),
    output_usd_per_mtok = coalesce((settings ->> 'output_usd_per_mtok')::numeric, s.output_usd_per_mtok),
    monthly_cost_limit_usd = coalesce((settings ->> 'monthly_cost_limit_usd')::numeric, s.monthly_cost_limit_usd),
    estimated_cost_per_scan_usd = coalesce((settings ->> 'estimated_cost_per_scan_usd')::numeric, s.estimated_cost_per_scan_usd),
    max_scans_per_minute = coalesce((settings ->> 'max_scans_per_minute')::integer, s.max_scans_per_minute),
    max_image_bytes = coalesce((settings ->> 'max_image_bytes')::integer, s.max_image_bytes)
  where s.id;
end;
$$;

create or replace function public.admin_set_ai_quota(target_plan public.subscription_plan, scans integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_system_admin() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  update public.plan_features set ai_scans_per_month = scans where plan = target_plan;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
end;
$$;

revoke all on function public.admin_get_ai_settings() from public, anon;
revoke all on function public.admin_set_ai_settings(jsonb) from public, anon;
revoke all on function public.admin_set_ai_quota(public.subscription_plan, integer) from public, anon;
grant execute on function public.admin_get_ai_settings() to authenticated;
grant execute on function public.admin_set_ai_settings(jsonb) to authenticated;
grant execute on function public.admin_set_ai_quota(public.subscription_plan, integer) to authenticated;

-- ---------- Eksport: organisasjonens AI-forbruk (uten innhold) ----------
create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;
  return jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid),
    'user_settings', (select to_jsonb(s) from public.user_settings s where s.user_id = v_uid),
    'legal_acceptances', coalesce((select jsonb_agg(to_jsonb(a) - 'user_id') from public.legal_acceptances a where a.user_id = v_uid), '[]'::jsonb),
    'organizations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'organization', to_jsonb(o),
        'role', m.role,
        'subscription', (select to_jsonb(s) - 'external_customer_id' - 'external_subscription_id' from public.subscriptions s where s.organization_id = o.id),
        'electricity_settings', (select e.settings from public.electricity_settings e where e.organization_id = o.id),
        'cost_settings', (select c.settings from public.cost_settings c where c.organization_id = o.id),
        'ingredients', coalesce((select jsonb_agg(to_jsonb(i)) from public.ingredients i where i.organization_id = o.id), '[]'::jsonb),
        'recipes', coalesce((select jsonb_agg(to_jsonb(rc)) from public.recipes rc where rc.organization_id = o.id), '[]'::jsonb),
        'recipe_ingredients', coalesce((select jsonb_agg(to_jsonb(ri)) from public.recipe_ingredients ri where ri.organization_id = o.id), '[]'::jsonb),
        'equipment', coalesce((select jsonb_agg(to_jsonb(eq)) from public.equipment eq where eq.organization_id = o.id), '[]'::jsonb),
        'menus', coalesce((select jsonb_agg(to_jsonb(mn)) from public.menus mn where mn.organization_id = o.id), '[]'::jsonb),
        'ai_usage', coalesce((select jsonb_agg(to_jsonb(au) - 'user_id') from public.ai_usage au where au.organization_id = o.id), '[]'::jsonb),
        'baking_history', coalesce((select jsonb_agg(to_jsonb(h)) from public.baking_history h where h.organization_id = o.id), '[]'::jsonb)
      ))
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
      where m.user_id = v_uid
    ), '[]'::jsonb)
  );
end;
$$;
