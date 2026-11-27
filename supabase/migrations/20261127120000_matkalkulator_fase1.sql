-- =====================================================================
-- Rett i lomma – Matkalkulator
-- Migrasjon 5: Fase 1 – virksomhetstyper, utstyrsregister og matoppskrifter
--
-- Bakoverkompatibel: alle nye kolonner har standardverdier eller fylles ut
-- for eksisterende rader, og ingen eksisterende kolonner eller data fjernes.
--  * organizations.business_type: eksisterende private kontoer blir «privat»,
--    eksisterende bedrifter blir «bakeri» (de har brukt Bakekalkulatoren).
--  * equipment: utvides til et utstyrsregister (tabellen fantes, men var ubrukt).
--  * recipes: kategori, porsjoner/stk, tilberedningstid og ferdig vekt.
--    Eksisterende oppskrifter får kategori ut fra bakeverketype.
-- =====================================================================

-- ---------- Virksomhetstype ----------
alter table public.organizations add column business_type text;

update public.organizations
   set business_type = case when type = 'private' then 'privat' else 'bakeri' end
 where business_type is null;

-- Fyller ut virksomhetstype når den mangler (f.eks. rader opprettet av eldre kode)
create or replace function public.set_default_business_type()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.business_type is null then
    new.business_type := case when new.type = 'private' then 'privat' else 'annet' end;
  end if;
  return new;
end;
$$;
create trigger set_default_business_type before insert or update on public.organizations
  for each row execute function public.set_default_business_type();

alter table public.organizations
  alter column business_type set not null,
  add constraint organizations_business_type_check
    check (business_type in ('privat', 'bakeri', 'restaurant', 'kafe', 'catering', 'kantine', 'matprodusent', 'annet')),
  -- Privatpersoner har alltid «privat»; bedrifter har aldri «privat».
  add constraint organizations_business_type_matches_type
    check ((type = 'private') = (business_type = 'privat'));

-- Eier og administrator kan endre virksomhetstype (RLS-policyen organizations_update_admin gjelder)
grant update (name, business_type) on public.organizations to authenticated;

-- ---------- Registrering: virksomhetstype fra metadata ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text := nullif(btrim(meta ->> 'full_name'), '');
  v_type public.organization_type := case when meta ->> 'account_type' = 'business' then 'business' else 'private' end;
  v_org_name text := nullif(btrim(meta ->> 'organization_name'), '');
  v_business text := meta ->> 'business_type';
  v_org uuid;
begin
  v_name := left(coalesce(v_name, nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Bruker'), 200);
  v_org_name := left(case when v_type = 'business' then coalesce(v_org_name, v_name) else v_name end, 200);
  -- Ukjent eller manglende verdi fra klienten gir «annet» for bedrifter
  v_business := case
    when v_type = 'private' then 'privat'
    when v_business in ('bakeri', 'restaurant', 'kafe', 'catering', 'kantine', 'matprodusent', 'annet') then v_business
    else 'annet'
  end;

  insert into public.profiles (id, full_name, email) values (new.id, v_name, new.email);

  insert into public.organizations (name, type, business_type, created_by)
  values (v_org_name, v_type, v_business, new.id)
  returning id into v_org;

  insert into public.organization_members (organization_id, user_id, role) values (v_org, new.id, 'owner');

  insert into public.subscriptions (organization_id, plan, status, trial_started_at, trial_ends_at)
  values (v_org, 'pro', 'trialing', now(), now() + interval '30 days');

  insert into public.user_settings (user_id, active_organization_id) values (new.id, v_org);

  insert into public.electricity_settings (organization_id, settings)
  values (v_org, jsonb_build_object('customerType', case when v_type = 'business' then 'bedrift' else 'privat' end));

  insert into public.legal_acceptances (user_id, document, version)
  select new.id, d.document, d.version
  from public.legal_documents d
  where d.is_current
    and ((d.document = 'terms' and d.version = meta ->> 'terms_version')
      or (d.document = 'privacy' and d.version = meta ->> 'privacy_version'))
  on conflict (user_id, document, version) do nothing;

  return new;
end;
$$;

-- ---------- Kontekst: virksomhetstype med ----------
create or replace function public.get_my_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;
  return jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid),
    'settings', (select to_jsonb(s) from public.user_settings s where s.user_id = v_uid),
    'is_system_admin', public.is_system_admin(),
    'legal', jsonb_build_object(
      'current', coalesce((select jsonb_agg(jsonb_build_object('document', d.document, 'version', d.version, 'url', d.url))
                           from public.legal_documents d where d.is_current), '[]'::jsonb),
      'accepted', coalesce((select jsonb_agg(jsonb_build_object('document', a.document, 'version', a.version, 'accepted_at', a.accepted_at) order by a.accepted_at)
                            from public.legal_acceptances a where a.user_id = v_uid), '[]'::jsonb)
    ),
    'organizations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'type', o.type,
        'business_type', o.business_type,
        'role', m.role,
        'member_count', (select count(*) from public.organization_members mm where mm.organization_id = o.id),
        'subscription', jsonb_build_object(
          'plan', s.plan,
          'status', s.status,
          'trial_started_at', s.trial_started_at,
          'trial_ends_at', s.trial_ends_at,
          'current_period_end', s.current_period_end,
          'effective_plan', public.effective_plan_internal(o.id)
        ),
        'features', (select to_jsonb(f) - 'updated_at' from public.plan_features f where f.plan = public.effective_plan_internal(o.id))
      ) order by m.created_at)
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
      left join public.subscriptions s on s.organization_id = o.id
      where m.user_id = v_uid
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------- Utstyrsregister ----------
-- Eksisterende kolonner beholdes:
--  * watt                 effekt (W)
--  * minutes              normal brukstid per produksjon (min)
--  * power_factor_percent effektandel under normal drift (%)
alter table public.equipment
  add column equipment_type text not null default 'annet'
    check (equipment_type in ('stekeovn', 'varmluftsovn', 'bakerovn', 'pizzaovn', 'komfyr', 'induksjonstopp', 'frityr', 'grill',
                              'mikrobolgeovn', 'eltemaskin', 'kjokkenmaskin', 'oppvaskmaskin', 'kjoleskap', 'fryser', 'ventilasjon', 'annet')),
  add column manufacturer text not null default '' check (char_length(manufacturer) <= 200),
  add column model text not null default '' check (char_length(model) <= 200),
  add column preheat_minutes numeric(10, 2) not null default 0 check (preheat_minutes between 0 and 1440),
  add column preheat_power_percent numeric(5, 2) not null default 100 check (preheat_power_percent between 0 and 100),
  -- Målt forbruk per produksjon (kWh, inkl. forvarming). Erstatter anslaget når det er satt.
  add column measured_kwh numeric(12, 4) check (measured_kwh is null or (measured_kwh > 0 and measured_kwh <= 100000)),
  add column output_per_run integer check (output_per_run is null or output_per_run between 1 and 1000000),
  -- Kontinuerlig utstyr (kjøleskap, fryser, ventilasjon) er felles driftskostnad, ikke per oppskrift
  add column continuous boolean not null default false,
  add column hours_per_day numeric(4, 2) not null default 24 check (hours_per_day between 0 and 24),
  -- Verdiene kommer fra en mal og er anslag til kunden har kontrollert dem
  add column is_estimate boolean not null default false,
  add column comment text not null default '' check (char_length(comment) <= 2000);

grant update (equipment_type, manufacturer, model, preheat_minutes, preheat_power_percent, measured_kwh,
              output_per_run, continuous, hours_per_day, is_estimate, comment) on public.equipment to authenticated;

-- Lagre utstyr (ny eller redigering). Id og organisasjon kan ikke endres av klienten.
create or replace function public.save_equipment(org uuid, item jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := coalesce(nullif(item ->> 'id', '')::uuid, gen_random_uuid());
begin
  if not public.is_org_member(org) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  update public.equipment set
    name = item ->> 'name',
    equipment_type = coalesce(nullif(item ->> 'equipment_type', ''), 'annet'),
    manufacturer = coalesce(item ->> 'manufacturer', ''),
    model = coalesce(item ->> 'model', ''),
    watt = (item ->> 'watt')::numeric,
    minutes = coalesce((item ->> 'minutes')::numeric, 0),
    power_factor_percent = coalesce((item ->> 'power_factor_percent')::numeric, 100),
    preheat_minutes = coalesce((item ->> 'preheat_minutes')::numeric, 0),
    preheat_power_percent = coalesce((item ->> 'preheat_power_percent')::numeric, 100),
    measured_kwh = nullif(item ->> 'measured_kwh', '')::numeric,
    output_per_run = nullif(item ->> 'output_per_run', '')::integer,
    continuous = coalesce((item ->> 'continuous')::boolean, false),
    hours_per_day = coalesce((item ->> 'hours_per_day')::numeric, 24),
    is_estimate = coalesce((item ->> 'is_estimate')::boolean, false),
    comment = coalesce(item ->> 'comment', '')
  where id = v_id and organization_id = org;
  if not found then
    if (select count(*) from public.equipment e where e.organization_id = org) >= 500 then
      raise exception using errcode = 'P0001', message = 'PLAN_LIMIT: Maks 500 enheter i utstyrsregisteret.';
    end if;
    insert into public.equipment (id, organization_id, name, equipment_type, manufacturer, model, watt, minutes, power_factor_percent,
                                  preheat_minutes, preheat_power_percent, measured_kwh, output_per_run, continuous, hours_per_day, is_estimate, comment)
    values (
      v_id, org, item ->> 'name',
      coalesce(nullif(item ->> 'equipment_type', ''), 'annet'),
      coalesce(item ->> 'manufacturer', ''), coalesce(item ->> 'model', ''),
      (item ->> 'watt')::numeric,
      coalesce((item ->> 'minutes')::numeric, 0),
      coalesce((item ->> 'power_factor_percent')::numeric, 100),
      coalesce((item ->> 'preheat_minutes')::numeric, 0),
      coalesce((item ->> 'preheat_power_percent')::numeric, 100),
      nullif(item ->> 'measured_kwh', '')::numeric,
      nullif(item ->> 'output_per_run', '')::integer,
      coalesce((item ->> 'continuous')::boolean, false),
      coalesce((item ->> 'hours_per_day')::numeric, 24),
      coalesce((item ->> 'is_estimate')::boolean, false),
      coalesce(item ->> 'comment', '')
    );
  end if;
  return v_id;
end;
$$;

revoke all on function public.save_equipment(uuid, jsonb) from public, anon;
grant execute on function public.save_equipment(uuid, jsonb) to authenticated;

-- ---------- Matoppskrifter ----------
alter table public.recipes
  add column category text not null default 'annet'
    check (category in ('brod_bakervarer', 'frokost', 'lunsj', 'forretter', 'hovedretter', 'supper', 'salater', 'pizza',
                        'desserter', 'drikke', 'sauser', 'tilbehor', 'catering', 'annet')),
  add column yield_unit text not null default 'stk' check (yield_unit in ('stk', 'porsjoner')),
  add column prep_minutes integer not null default 0 check (prep_minutes between 0 and 10080),
  add column finished_weight_g numeric(14, 2) check (finished_weight_g is null or (finished_weight_g > 0 and finished_weight_g <= 10000000));

update public.recipes set category = case
  when type in ('brod', 'rundstykker', 'kake', 'boller') then 'brod_bakervarer'
  when type = 'pizza' then 'pizza'
  else 'annet'
end;

grant update (category, yield_unit, prep_minutes, finished_weight_g) on public.recipes to authenticated;

-- Lagre oppskrift med linjer atomisk (som før, med de nye feltene)
create or replace function public.save_recipe(org uuid, recipe jsonb, lines jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := coalesce(nullif(recipe ->> 'id', '')::uuid, gen_random_uuid());
  l jsonb;
  i integer := 0;
begin
  if not public.is_org_member(org) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  update public.recipes set
    name = recipe ->> 'name',
    type = coalesce(nullif(recipe ->> 'type', ''), 'annet')::public.bake_type,
    category = coalesce(nullif(recipe ->> 'category', ''), category),
    yield_unit = coalesce(nullif(recipe ->> 'yield_unit', ''), yield_unit),
    yield_count = (recipe ->> 'yield_count')::integer,
    steps = coalesce(array(select jsonb_array_elements_text(recipe -> 'steps')), '{}'),
    prep_minutes = coalesce((recipe ->> 'prep_minutes')::integer, 0),
    rise_minutes = coalesce((recipe ->> 'rise_minutes')::integer, 0),
    bake_minutes = coalesce((recipe ->> 'bake_minutes')::integer, 0),
    finished_weight_g = nullif(recipe ->> 'finished_weight_g', '')::numeric,
    store_price_per_item = coalesce((recipe ->> 'store_price_per_item')::numeric, 0),
    notes = coalesce(recipe ->> 'notes', ''),
    energy = coalesce(recipe -> 'energy', '{}'::jsonb)
  where id = v_id and organization_id = org;

  if not found then
    insert into public.recipes (id, organization_id, name, type, category, yield_unit, yield_count, steps, prep_minutes, rise_minutes,
                                bake_minutes, finished_weight_g, store_price_per_item, notes, energy)
    values (
      v_id, org,
      recipe ->> 'name',
      coalesce(nullif(recipe ->> 'type', ''), 'annet')::public.bake_type,
      coalesce(nullif(recipe ->> 'category', ''), 'annet'),
      coalesce(nullif(recipe ->> 'yield_unit', ''), 'stk'),
      (recipe ->> 'yield_count')::integer,
      coalesce(array(select jsonb_array_elements_text(recipe -> 'steps')), '{}'),
      coalesce((recipe ->> 'prep_minutes')::integer, 0),
      coalesce((recipe ->> 'rise_minutes')::integer, 0),
      coalesce((recipe ->> 'bake_minutes')::integer, 0),
      nullif(recipe ->> 'finished_weight_g', '')::numeric,
      coalesce((recipe ->> 'store_price_per_item')::numeric, 0),
      coalesce(recipe ->> 'notes', ''),
      coalesce(recipe -> 'energy', '{}'::jsonb)
    );
  end if;

  delete from public.recipe_ingredients where recipe_id = v_id and organization_id = org;
  for l in select * from jsonb_array_elements(coalesce(lines, '[]'::jsonb)) loop
    insert into public.recipe_ingredients (id, organization_id, recipe_id, ingredient_id, position, amount, unit)
    values (
      gen_random_uuid(), org, v_id,
      nullif(l ->> 'ingredient_id', '')::uuid, i,
      (l ->> 'amount')::numeric, (l ->> 'unit')::public.measure_unit
    );
    i := i + 1;
  end loop;
  return v_id;
end;
$$;
