-- =====================================================================
-- Rett i lomma – Matkalkulator
-- Migrasjon 6: Fase 2 – allergener, underoppskrifter, arbeidstid,
-- personal- og driftskostnader og menyer
--
-- Bakoverkompatibel: bare nye kolonner og tabeller med standardverdier.
--  * ingredients: allergener (tomt kart = ukjent status for alle 14)
--  * recipes: arbeidstid, emballasje og risiko for krysskontakt
--  * recipe_ingredients: underoppskrifter, med sperre mot sirkulære referanser
--  * cost_settings: personal- og driftskostnader per organisasjon (eier/admin endrer)
--  * menus: menyer med retter (medlemmer)
-- Krever migrasjon 5 (fase 1).
-- =====================================================================

-- ---------- Allergener på ingredienser ----------
-- Kart fra allergenkode til 'ja' | 'spor' | 'nei'. Allergen som mangler = ukjent.
create or replace function public.valid_allergen_map(m jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(m) = 'object'
     and not exists (
       select 1 from jsonb_each(m) e
       where e.key not in ('gluten', 'skalldyr', 'egg', 'fisk', 'peanotter', 'soya', 'melk',
                           'notter', 'selleri', 'sennep', 'sesam', 'sulfitt', 'lupin', 'blotdyr')
          or jsonb_typeof(e.value) <> 'string'
          or e.value #>> '{}' not in ('ja', 'spor', 'nei')
     );
$$;

alter table public.ingredients
  add column allergens jsonb not null default '{}'::jsonb check (public.valid_allergen_map(allergens)),
  -- false når opplysningene kommer fra AI/skanning og ikke er kontrollert av kunden
  add column allergens_checked boolean not null default true;

grant update (allergens, allergens_checked) on public.ingredients to authenticated;

-- ---------- Oppskrifter: arbeidstid, emballasje, krysskontakt ----------
create or replace function public.valid_labor(l jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(l) = 'array'
     and jsonb_array_length(l) <= 50
     and not exists (
       select 1 from jsonb_array_elements(l) x
       where jsonb_typeof(x) <> 'object'
          or jsonb_typeof(x -> 'people') <> 'number' or (x ->> 'people')::numeric < 0 or (x ->> 'people')::numeric > 1000
          or jsonb_typeof(x -> 'minutes') <> 'number' or (x ->> 'minutes')::numeric < 0 or (x ->> 'minutes')::numeric > 100000
          or char_length(coalesce(x ->> 'roleId', '')) > 100
     );
$$;

alter table public.recipes
  add column labor jsonb not null default '[]'::jsonb check (public.valid_labor(labor)),
  add column packaging_per_unit numeric(12, 2) not null default 0 check (packaging_per_unit between 0 and 100000),
  add column cross_contact text[] not null default '{}'
    check (cross_contact <@ array['gluten', 'skalldyr', 'egg', 'fisk', 'peanotter', 'soya', 'melk',
                                  'notter', 'selleri', 'sennep', 'sesam', 'sulfitt', 'lupin', 'blotdyr']);

grant update (labor, packaging_per_unit, cross_contact) on public.recipes to authenticated;

-- Kontrollfunksjonene brukes i CHECK-begrensninger og må kunne kjøres av innloggede brukere
grant execute on function public.valid_allergen_map(jsonb), public.valid_labor(jsonb) to authenticated;

-- ---------- Underoppskrifter ----------
alter table public.recipe_ingredients
  add column sub_recipe_id uuid,
  add constraint recipe_ingredients_sub_recipe_fkey
    foreign key (sub_recipe_id, organization_id) references public.recipes (id, organization_id)
    on delete set null (sub_recipe_id),
  -- En linje er enten en ingrediens eller en underoppskrift
  add constraint recipe_ingredients_one_source check (ingredient_id is null or sub_recipe_id is null),
  add constraint recipe_ingredients_not_self check (sub_recipe_id is null or sub_recipe_id <> recipe_id);

create index recipe_ingredients_sub_recipe_idx on public.recipe_ingredients (sub_recipe_id) where sub_recipe_id is not null;

-- Sperre mot sirkulære referanser (A → B → A), også over flere ledd
create or replace function public.prevent_recipe_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sub_recipe_id is null then
    return new;
  end if;
  if exists (
    with recursive down(id, depth) as (
      select new.sub_recipe_id, 1
      union
      select ri.sub_recipe_id, d.depth + 1
      from down d
      join public.recipe_ingredients ri on ri.recipe_id = d.id and ri.organization_id = new.organization_id
      where ri.sub_recipe_id is not null and d.depth < 50
    )
    select 1 from down where id = new.recipe_id
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID: En underoppskrift kan ikke bruke oppskriften den inngår i (sirkulær referanse).';
  end if;
  return new;
end;
$$;

create trigger prevent_recipe_cycle before insert or update of sub_recipe_id on public.recipe_ingredients
  for each row execute function public.prevent_recipe_cycle();

-- ---------- Lagre ingrediens (med allergener) ----------
-- Eldre klienter som ikke sender allergener, beholder de lagrede.
create or replace function public.save_ingredient(org uuid, ingredient jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := coalesce(nullif(ingredient ->> 'id', '')::uuid, gen_random_uuid());
begin
  if not public.is_org_member(org) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  update public.ingredients set
    name = ingredient ->> 'name',
    category = coalesce(ingredient ->> 'category', ''),
    package_size = (ingredient ->> 'package_size')::numeric,
    unit = (ingredient ->> 'unit')::public.measure_unit,
    price = (ingredient ->> 'price')::numeric,
    store = coalesce(ingredient ->> 'store', ''),
    price_updated = coalesce(nullif(ingredient ->> 'price_updated', '')::date, current_date),
    allergens = coalesce(ingredient -> 'allergens', allergens),
    allergens_checked = coalesce((ingredient ->> 'allergens_checked')::boolean, allergens_checked)
  where id = v_id and organization_id = org;
  if not found then
    insert into public.ingredients (id, organization_id, name, category, package_size, unit, price, store, price_updated, allergens, allergens_checked)
    values (
      v_id, org, ingredient ->> 'name', coalesce(ingredient ->> 'category', ''),
      (ingredient ->> 'package_size')::numeric, (ingredient ->> 'unit')::public.measure_unit,
      (ingredient ->> 'price')::numeric, coalesce(ingredient ->> 'store', ''),
      coalesce(nullif(ingredient ->> 'price_updated', '')::date, current_date),
      coalesce(ingredient -> 'allergens', '{}'::jsonb),
      coalesce((ingredient ->> 'allergens_checked')::boolean, true)
    );
  end if;
  return v_id;
end;
$$;

-- ---------- Lagre oppskrift (med arbeidstid, emballasje, krysskontakt og underoppskrifter) ----------
create or replace function public.save_recipe(org uuid, recipe jsonb, lines jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := coalesce(nullif(recipe ->> 'id', '')::uuid, gen_random_uuid());
  v_cross text[] := case when recipe ? 'cross_contact'
                         then coalesce(array(select jsonb_array_elements_text(recipe -> 'cross_contact')), '{}')
                         else null end;
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
    energy = coalesce(recipe -> 'energy', '{}'::jsonb),
    -- Eldre klienter som ikke sender feltene, beholder de lagrede verdiene
    labor = coalesce(recipe -> 'labor', labor),
    packaging_per_unit = coalesce((recipe ->> 'packaging_per_unit')::numeric, packaging_per_unit),
    cross_contact = coalesce(v_cross, cross_contact)
  where id = v_id and organization_id = org;

  if not found then
    insert into public.recipes (id, organization_id, name, type, category, yield_unit, yield_count, steps, prep_minutes, rise_minutes,
                                bake_minutes, finished_weight_g, store_price_per_item, notes, energy, labor, packaging_per_unit, cross_contact)
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
      coalesce(recipe -> 'energy', '{}'::jsonb),
      coalesce(recipe -> 'labor', '[]'::jsonb),
      coalesce((recipe ->> 'packaging_per_unit')::numeric, 0),
      coalesce(v_cross, '{}')
    );
  end if;

  delete from public.recipe_ingredients where recipe_id = v_id and organization_id = org;
  for l in select * from jsonb_array_elements(coalesce(lines, '[]'::jsonb)) loop
    insert into public.recipe_ingredients (id, organization_id, recipe_id, ingredient_id, sub_recipe_id, position, amount, unit)
    values (
      gen_random_uuid(), org, v_id,
      nullif(l ->> 'ingredient_id', '')::uuid,
      nullif(l ->> 'sub_recipe_id', '')::uuid,
      i,
      (l ->> 'amount')::numeric, (l ->> 'unit')::public.measure_unit
    );
    i := i + 1;
  end loop;
  return v_id;
end;
$$;

-- ---------- Personal- og driftskostnader ----------
-- Én rad per organisasjon. Alle medlemmer leser (trengs for kalkulasjonen),
-- bare eier og administrator endrer (via save_cost_settings).
create table public.cost_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 200000),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.cost_settings for each row execute function public.set_updated_at();
create trigger protect_row_identity before update on public.cost_settings for each row execute function public.protect_row_identity();
create trigger set_updated_by before insert or update on public.cost_settings for each row execute function public.set_updated_by();

alter table public.cost_settings enable row level security;
revoke all on public.cost_settings from public, anon, authenticated;
grant select on public.cost_settings to authenticated;

create policy cost_settings_select_member on public.cost_settings
  for select to authenticated using (public.is_org_member(organization_id));

create or replace function public.save_cost_settings(org uuid, settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_org_role(org, array['owner', 'admin']::public.organization_role[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: Bare eier eller administrator kan endre personal- og driftskostnader.';
  end if;
  if jsonb_typeof(coalesce(settings, 'null'::jsonb)) <> 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID: Ugyldige kostnadsinnstillinger.';
  end if;
  insert into public.cost_settings (organization_id, settings)
  values (org, settings)
  on conflict (organization_id) do update set settings = excluded.settings;
end;
$$;

revoke all on function public.save_cost_settings(uuid, jsonb) from public, anon;
grant execute on function public.save_cost_settings(uuid, jsonb) to authenticated;

-- ---------- Menyer ----------
create table public.menus (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  menu_type text not null default 'egen' check (menu_type in ('frokost', 'lunsj', 'middag', 'dagens', 'catering', 'sesong', 'egen')),
  description text not null default '' check (char_length(description) <= 2000),
  -- Retter: [{id, recipeId, name, price, vatPercent}]. Oppskriften kan slettes; retten vises da som slettet.
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 300),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create index menus_organization_idx on public.menus (organization_id);
create trigger set_updated_at before update on public.menus for each row execute function public.set_updated_at();
create trigger protect_row_identity before update on public.menus for each row execute function public.protect_row_identity();
create trigger set_insert_metadata before insert on public.menus for each row execute function public.set_insert_metadata();

alter table public.menus enable row level security;
revoke all on public.menus from public, anon, authenticated;
grant select, insert, delete on public.menus to authenticated;
grant update (name, menu_type, description, items) on public.menus to authenticated;

create policy menus_member_all on public.menus
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create or replace function public.save_menu(org uuid, menu jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := coalesce(nullif(menu ->> 'id', '')::uuid, gen_random_uuid());
begin
  if not public.is_org_member(org) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  update public.menus set
    name = menu ->> 'name',
    menu_type = coalesce(nullif(menu ->> 'menu_type', ''), 'egen'),
    description = coalesce(menu ->> 'description', ''),
    items = coalesce(menu -> 'items', '[]'::jsonb)
  where id = v_id and organization_id = org;
  if not found then
    if (select count(*) from public.menus m where m.organization_id = org) >= 200 then
      raise exception using errcode = 'P0001', message = 'PLAN_LIMIT: Maks 200 menyer.';
    end if;
    insert into public.menus (id, organization_id, name, menu_type, description, items)
    values (v_id, org, menu ->> 'name', coalesce(nullif(menu ->> 'menu_type', ''), 'egen'),
            coalesce(menu ->> 'description', ''), coalesce(menu -> 'items', '[]'::jsonb));
  end if;
  return v_id;
end;
$$;

revoke all on function public.save_menu(uuid, jsonb) from public, anon;
grant execute on function public.save_menu(uuid, jsonb) to authenticated;

-- ---------- Eksport: nye tabeller med ----------
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
        'baking_history', coalesce((select jsonb_agg(to_jsonb(h)) from public.baking_history h where h.organization_id = o.id), '[]'::jsonb)
      ))
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
      where m.user_id = v_uid
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------- Import av lokale data: nye felt og underoppskrifter ----------
-- Som før (idempotent, atomisk, låst organisasjon), og i tillegg:
--  * ingrediensenes allergener og oppskriftenes fase 1- og fase 2-felt
--  * underoppskrifter: linjene settes inn etter at alle oppskrifter finnes,
--    slik at rekkefølgen i importen ikke spiller noen rolle
create or replace function public.import_local_data(org uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  it jsonb;
  ln jsonb;
  v_local text;
  v_id uuid;
  v_ing uuid;
  v_sub uuid;
  pos integer;
  v_new jsonb := '[]'::jsonb;
  ing_new integer := 0;
  ing_skip integer := 0;
  rec_new integer := 0;
  rec_skip integer := 0;
begin
  if not public.is_org_member(org) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if jsonb_typeof(coalesce(payload, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID: Ugyldig importformat.';
  end if;
  perform public.lock_organization(org);

  for it in select * from jsonb_array_elements(coalesce(payload -> 'ingredients', '[]'::jsonb)) loop
    v_local := btrim(coalesce(it ->> 'local_id', ''));
    if v_local = '' or char_length(v_local) > 100 then
      raise exception using errcode = 'P0001', message = 'INVALID: Alle ingredienser må ha en gyldig lokal id.';
    end if;
    if exists (select 1 from public.ingredients i where i.organization_id = org and i.local_id = v_local) then
      ing_skip := ing_skip + 1;
      continue;
    end if;
    insert into public.ingredients (organization_id, local_id, name, category, package_size, unit, price, store, price_updated, allergens, allergens_checked)
    values (
      org, v_local, it ->> 'name', coalesce(it ->> 'category', ''),
      (it ->> 'package_size')::numeric, (it ->> 'unit')::public.measure_unit, (it ->> 'price')::numeric,
      coalesce(it ->> 'store', ''), coalesce(nullif(it ->> 'price_updated', '')::date, current_date),
      coalesce(it -> 'allergens', '{}'::jsonb), coalesce((it ->> 'allergens_checked')::boolean, true)
    )
    on conflict (organization_id, local_id) do nothing;
    ing_new := ing_new + 1;
  end loop;

  for it in select * from jsonb_array_elements(coalesce(payload -> 'recipes', '[]'::jsonb)) loop
    v_local := btrim(coalesce(it ->> 'local_id', ''));
    if v_local = '' or char_length(v_local) > 100 then
      raise exception using errcode = 'P0001', message = 'INVALID: Alle oppskrifter må ha en gyldig lokal id.';
    end if;
    if exists (select 1 from public.recipes r where r.organization_id = org and r.local_id = v_local) then
      rec_skip := rec_skip + 1;
      continue;
    end if;
    v_id := null;
    insert into public.recipes (organization_id, local_id, name, type, category, yield_unit, yield_count, steps, prep_minutes, rise_minutes,
                                bake_minutes, finished_weight_g, store_price_per_item, notes, energy, labor, packaging_per_unit, cross_contact)
    values (
      org, v_local, it ->> 'name',
      coalesce(nullif(it ->> 'type', ''), 'annet')::public.bake_type,
      coalesce(nullif(it ->> 'category', ''), case
        when it ->> 'type' in ('brod', 'rundstykker', 'kake', 'boller') then 'brod_bakervarer'
        when it ->> 'type' = 'pizza' then 'pizza' else 'annet' end),
      coalesce(nullif(it ->> 'yield_unit', ''), 'stk'),
      (it ->> 'yield_count')::integer,
      coalesce(array(select jsonb_array_elements_text(it -> 'steps')), '{}'),
      coalesce((it ->> 'prep_minutes')::integer, 0),
      coalesce((it ->> 'rise_minutes')::integer, 0),
      coalesce((it ->> 'bake_minutes')::integer, 0),
      nullif(it ->> 'finished_weight_g', '')::numeric,
      coalesce((it ->> 'store_price_per_item')::numeric, 0),
      coalesce(it ->> 'notes', ''),
      coalesce(it -> 'energy', '{}'::jsonb),
      coalesce(it -> 'labor', '[]'::jsonb),
      coalesce((it ->> 'packaging_per_unit')::numeric, 0),
      coalesce(array(select jsonb_array_elements_text(it -> 'cross_contact')), '{}')
    )
    on conflict (organization_id, local_id) do nothing
    returning id into v_id;

    if v_id is null then
      rec_skip := rec_skip + 1;
    else
      rec_new := rec_new + 1;
      v_new := v_new || jsonb_build_array(jsonb_build_object('id', v_id, 'lines', coalesce(it -> 'ingredients', '[]'::jsonb)));
    end if;
  end loop;

  -- Linjene settes inn når alle oppskriftene finnes (underoppskrifter kan stå senere i importen)
  for it in select * from jsonb_array_elements(v_new) loop
    pos := 0;
    for ln in select * from jsonb_array_elements(it -> 'lines') loop
      v_ing := null;
      v_sub := null;
      select i.id into v_ing from public.ingredients i
       where i.organization_id = org and i.local_id = nullif(btrim(coalesce(ln ->> 'ingredient_local_id', '')), '');
      select r.id into v_sub from public.recipes r
       where r.organization_id = org and r.local_id = nullif(btrim(coalesce(ln ->> 'sub_recipe_local_id', '')), '');
      insert into public.recipe_ingredients (organization_id, recipe_id, ingredient_id, sub_recipe_id, position, amount, unit)
      values (org, (it ->> 'id')::uuid, case when v_sub is null then v_ing end, v_sub, pos,
              (ln ->> 'amount')::numeric, (ln ->> 'unit')::public.measure_unit);
      pos := pos + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'ingredients_inserted', ing_new, 'ingredients_skipped', ing_skip,
    'recipes_inserted', rec_new, 'recipes_skipped', rec_skip
  );
end;
$$;
