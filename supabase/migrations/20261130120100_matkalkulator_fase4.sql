-- =====================================================================
-- Rett i lomma – Matkalkulator
-- Migrasjon 9: Fase 4 – leverandører, prishistorikk, lager, matsvinn,
-- Business-abonnementer og dashboard
--
--  * plan_features: Business (50 brukere, 500 AI-skanninger) og Business Plus
--    (200 brukere, 1 000 AI-skanninger). Nye funksjonsflagg:
--      inventory           lager, matsvinnregistrering og flere leverandører per vare
--      advanced_dashboard  utvidet dashboard med trender (Business Plus)
--    Eksisterende planer og abonnementer endres ikke.
--  * suppliers: leverandørregister (alle planer).
--  * ingredients: strekkode, produsent, leverandør, varenummer, mva, råvaresvinn,
--    kommentar og minimumsbeholdning.
--  * ingredient_prices: prishistorikk (automatisk ved prisendring, alle planer)
--    og tilbud fra andre leverandører (Business).
--  * recipes.waste_percent: tilberedningssvinn.
--  * stock_movements + stock_levels: lager (Business).
--  * waste_logs: registrert matsvinn (Business).
-- Funksjonsgrensene håndheves i databasen (RLS og funksjoner), ikke bare i appen.
-- Krever migrasjon 5–8.
-- =====================================================================

-- ---------- Planer ----------
alter table public.plan_features
  add column inventory boolean not null default false,
  add column advanced_dashboard boolean not null default false;

insert into public.plan_features (plan, max_recipes, max_ingredients, max_members, sales_calculator, ai_scans_per_month, inventory, advanced_dashboard) values
  ('business', null, null, 50, true, 500, true, false),
  ('business_plus', null, null, 200, true, 1000, true, true)
on conflict (plan) do update set
  max_recipes = excluded.max_recipes, max_ingredients = excluded.max_ingredients, max_members = excluded.max_members,
  sales_calculator = excluded.sales_calculator, ai_scans_per_month = excluded.ai_scans_per_month,
  inventory = excluded.inventory, advanced_dashboard = excluded.advanced_dashboard;

-- Har organisasjonen en funksjon i sin effektive plan?
create or replace function public.org_has_feature(org uuid, feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case feature
      when 'inventory' then f.inventory
      when 'advanced_dashboard' then f.advanced_dashboard
      else false end
    from public.plan_features f
    where f.plan = public.effective_plan_internal(org)
  ), false);
$$;
revoke all on function public.org_has_feature(uuid, text) from public, anon;
grant execute on function public.org_has_feature(uuid, text) to authenticated, service_role;

-- ---------- Leverandører ----------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  contact_person text not null default '' check (char_length(contact_person) <= 200),
  phone text not null default '' check (char_length(phone) <= 50),
  email text not null default '' check (char_length(email) <= 200),
  customer_number text not null default '' check (char_length(customer_number) <= 100),
  comment text not null default '' check (char_length(comment) <= 2000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index suppliers_org_idx on public.suppliers (organization_id);
create trigger set_updated_at before update on public.suppliers for each row execute function public.set_updated_at();
create trigger protect_row_identity before update on public.suppliers for each row execute function public.protect_row_identity();
create trigger set_insert_metadata before insert on public.suppliers for each row execute function public.set_insert_metadata();

alter table public.suppliers enable row level security;
revoke all on public.suppliers from public, anon, authenticated;
grant select, insert, delete on public.suppliers to authenticated;
grant update (name, contact_person, phone, email, customer_number, comment) on public.suppliers to authenticated;
create policy suppliers_member_all on public.suppliers
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- ---------- Ingredienser: innkjøpsdata ----------
alter table public.ingredients
  add column ean text check (ean is null or ean ~ '^[0-9]{8,14}$'),
  add column manufacturer text not null default '' check (char_length(manufacturer) <= 200),
  add column supplier_id uuid,
  add column supplier_item_no text not null default '' check (char_length(supplier_item_no) <= 100),
  add column vat_percent numeric(5, 2) not null default 15 check (vat_percent between 0 and 100),
  -- Råvaresvinn: andel av innkjøpt mengde som ikke kan brukes (skrell, ben, fett ...)
  add column waste_percent numeric(5, 2) not null default 0 check (waste_percent >= 0 and waste_percent < 95),
  add column comment text not null default '' check (char_length(comment) <= 2000),
  -- Varsel når lagerbeholdningen er lavere (i ingrediensens enhet)
  add column min_stock numeric(14, 4) check (min_stock is null or min_stock >= 0),
  add constraint ingredients_supplier_fkey foreign key (supplier_id, organization_id)
    references public.suppliers (id, organization_id) on delete set null (supplier_id);

grant update (ean, manufacturer, supplier_id, supplier_item_no, vat_percent, waste_percent, comment, min_stock) on public.ingredients to authenticated;

-- ---------- Oppskrifter: tilberedningssvinn ----------
alter table public.recipes
  add column waste_percent numeric(5, 2) not null default 0 check (waste_percent >= 0 and waste_percent < 95);
grant update (waste_percent) on public.recipes to authenticated;

-- ---------- Prishistorikk og tilbud ----------
create table public.ingredient_prices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  ingredient_id uuid not null,
  supplier_id uuid,
  supplier_item_no text not null default '' check (char_length(supplier_item_no) <= 100),
  package_size numeric(14, 4) not null check (package_size > 0),
  unit public.measure_unit not null,
  price numeric(12, 2) not null check (price >= 0),
  vat_percent numeric(5, 2) check (vat_percent is null or vat_percent between 0 and 100),
  priced_at date not null default current_date,
  -- 'historikk': skrevet automatisk ved prisendring. 'tilbud': pris fra en annen leverandør (Business).
  source text not null check (source in ('historikk', 'tilbud')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (ingredient_id, organization_id) references public.ingredients (id, organization_id) on delete cascade,
  foreign key (supplier_id, organization_id) references public.suppliers (id, organization_id) on delete set null (supplier_id)
);
create index ingredient_prices_ing_idx on public.ingredient_prices (ingredient_id, priced_at desc);
create index ingredient_prices_org_idx on public.ingredient_prices (organization_id, priced_at desc);

alter table public.ingredient_prices enable row level security;
revoke all on public.ingredient_prices from public, anon, authenticated;
grant select, insert, delete on public.ingredient_prices to authenticated;
create policy ingredient_prices_select_member on public.ingredient_prices
  for select to authenticated using (public.is_org_member(organization_id));
-- Historikken skrives bare av triggeren. Medlemmer kan legge inn og slette tilbud (Business).
create policy ingredient_prices_insert_offer on public.ingredient_prices
  for insert to authenticated
  with check (source = 'tilbud' and public.is_org_member(organization_id) and public.org_has_feature(organization_id, 'inventory'));
create policy ingredient_prices_delete_offer on public.ingredient_prices
  for delete to authenticated
  using (source = 'tilbud' and public.is_org_member(organization_id));
create trigger set_insert_metadata before insert on public.ingredient_prices for each row execute function public.set_insert_metadata();

-- Ny rad i historikken når en ingrediens opprettes eller får ny pris, pakning,
-- enhet eller leverandør. Historiske produksjonskostnader påvirkes ikke
-- (de er lagret som øyeblikksbilder i baking_history).
create or replace function public.record_ingredient_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.price = old.price and new.package_size = old.package_size and new.unit = old.unit
     and new.supplier_id is not distinct from old.supplier_id then
    return new;
  end if;
  insert into public.ingredient_prices (organization_id, ingredient_id, supplier_id, supplier_item_no, package_size, unit, price, vat_percent, priced_at, source)
  values (new.organization_id, new.id, new.supplier_id, new.supplier_item_no, new.package_size, new.unit, new.price, new.vat_percent,
          coalesce(new.price_updated, current_date), 'historikk');
  return new;
end;
$$;
create trigger record_ingredient_price after insert or update on public.ingredients
  for each row execute function public.record_ingredient_price();

-- Eksisterende priser blir første punkt i historikken
insert into public.ingredient_prices (organization_id, ingredient_id, package_size, unit, price, priced_at, source, created_by)
select i.organization_id, i.id, i.package_size, i.unit, i.price, i.price_updated, 'historikk', i.created_by
from public.ingredients i;

-- ---------- Lagre ingrediens (med innkjøpsdata) ----------
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
    allergens_checked = coalesce((ingredient ->> 'allergens_checked')::boolean, allergens_checked),
    -- Eldre klienter som ikke sender feltene, beholder de lagrede verdiene
    ean = case when ingredient ? 'ean' then nullif(ingredient ->> 'ean', '') else ean end,
    manufacturer = coalesce(ingredient ->> 'manufacturer', manufacturer),
    supplier_id = case when ingredient ? 'supplier_id' then nullif(ingredient ->> 'supplier_id', '')::uuid else supplier_id end,
    supplier_item_no = coalesce(ingredient ->> 'supplier_item_no', supplier_item_no),
    vat_percent = coalesce((ingredient ->> 'vat_percent')::numeric, vat_percent),
    waste_percent = coalesce((ingredient ->> 'waste_percent')::numeric, waste_percent),
    comment = coalesce(ingredient ->> 'comment', comment),
    min_stock = case when ingredient ? 'min_stock' then nullif(ingredient ->> 'min_stock', '')::numeric else min_stock end
  where id = v_id and organization_id = org;
  if not found then
    insert into public.ingredients (id, organization_id, name, category, package_size, unit, price, store, price_updated, allergens, allergens_checked,
                                    ean, manufacturer, supplier_id, supplier_item_no, vat_percent, waste_percent, comment, min_stock)
    values (
      v_id, org, ingredient ->> 'name', coalesce(ingredient ->> 'category', ''),
      (ingredient ->> 'package_size')::numeric, (ingredient ->> 'unit')::public.measure_unit,
      (ingredient ->> 'price')::numeric, coalesce(ingredient ->> 'store', ''),
      coalesce(nullif(ingredient ->> 'price_updated', '')::date, current_date),
      coalesce(ingredient -> 'allergens', '{}'::jsonb),
      coalesce((ingredient ->> 'allergens_checked')::boolean, true),
      nullif(ingredient ->> 'ean', ''),
      coalesce(ingredient ->> 'manufacturer', ''),
      nullif(ingredient ->> 'supplier_id', '')::uuid,
      coalesce(ingredient ->> 'supplier_item_no', ''),
      coalesce((ingredient ->> 'vat_percent')::numeric, 15),
      coalesce((ingredient ->> 'waste_percent')::numeric, 0),
      coalesce(ingredient ->> 'comment', ''),
      nullif(ingredient ->> 'min_stock', '')::numeric
    );
  end if;
  return v_id;
end;
$$;

-- ---------- Lagre oppskrift (med tilberedningssvinn) ----------
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
    cross_contact = coalesce(v_cross, cross_contact),
    waste_percent = coalesce((recipe ->> 'waste_percent')::numeric, waste_percent)
  where id = v_id and organization_id = org;

  if not found then
    insert into public.recipes (id, organization_id, name, type, category, yield_unit, yield_count, steps, prep_minutes, rise_minutes,
                                bake_minutes, finished_weight_g, store_price_per_item, notes, energy, labor, packaging_per_unit, cross_contact, waste_percent)
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
      coalesce(v_cross, '{}'),
      coalesce((recipe ->> 'waste_percent')::numeric, 0)
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

-- ---------- Lager (Business) ----------
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  ingredient_id uuid not null,
  -- Mengde i ingrediensens enhet. Positiv = inn, negativ = ut.
  quantity numeric(14, 4) not null check (quantity <> 0 and abs(quantity) <= 100000000),
  kind text not null check (kind in ('innkjop', 'forbruk', 'svinn', 'telling', 'justering')),
  moved_at timestamptz not null default now(),
  -- Pris per enhet på tidspunktet (øyeblikksbilde for lagerverdi og svinnkostnad)
  unit_cost numeric(14, 6) not null default 0 check (unit_cost >= 0),
  note text not null default '' check (char_length(note) <= 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (ingredient_id, organization_id) references public.ingredients (id, organization_id) on delete cascade
);
create index stock_movements_ing_idx on public.stock_movements (ingredient_id);
create index stock_movements_org_idx on public.stock_movements (organization_id, moved_at desc);
create trigger set_insert_metadata before insert on public.stock_movements for each row execute function public.set_insert_metadata();

alter table public.stock_movements enable row level security;
revoke all on public.stock_movements from public, anon, authenticated;
grant select, insert, delete on public.stock_movements to authenticated;
create policy stock_select_member on public.stock_movements
  for select to authenticated using (public.is_org_member(organization_id));
create policy stock_insert_business on public.stock_movements
  for insert to authenticated
  with check (public.is_org_member(organization_id) and public.org_has_feature(organization_id, 'inventory'));
-- Bevegelser rettes med nye bevegelser. Bare eier/administrator kan slette.
create policy stock_delete_admin on public.stock_movements
  for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]));

create view public.stock_levels with (security_invoker = true) as
  select m.organization_id, m.ingredient_id, sum(m.quantity) as quantity, max(m.moved_at) as last_moved_at
  from public.stock_movements m
  group by m.organization_id, m.ingredient_id;
revoke all on public.stock_levels from public, anon, authenticated;
grant select on public.stock_levels to authenticated;

-- Varetelling: setter beholdningen til talt mengde (differansen lagres som bevegelse).
create or replace function public.stock_count(org uuid, ingredient uuid, counted numeric, cost numeric default 0, note text default '')
returns numeric
language plpgsql
-- security definer for låsen per organisasjon. Medlemskap og plan kontrolleres under,
-- og sammensatt fremmednøkkel hindrer ingredienser fra andre organisasjoner.
security definer
set search_path = ''
as $$
declare
  v_now numeric;
  v_delta numeric;
begin
  if not public.is_org_member(org) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if not public.org_has_feature(org, 'inventory') then
    raise exception using errcode = 'P0001', message = 'PLAN_FEATURE: Lagerstyring krever Business.';
  end if;
  if counted is null or counted < 0 then
    raise exception using errcode = 'P0001', message = 'INVALID: Talt mengde kan ikke være negativ.';
  end if;
  perform public.lock_organization(org);
  select coalesce(sum(m.quantity), 0) into v_now from public.stock_movements m where m.organization_id = org and m.ingredient_id = ingredient;
  v_delta := counted - v_now;
  if v_delta <> 0 then
    insert into public.stock_movements (organization_id, ingredient_id, quantity, kind, unit_cost, note)
    values (org, ingredient, v_delta, 'telling', greatest(coalesce(cost, 0), 0), coalesce(note, ''));
  end if;
  return v_delta;
end;
$$;
revoke all on function public.stock_count(uuid, uuid, numeric, numeric, text) from public, anon;
grant execute on function public.stock_count(uuid, uuid, numeric, numeric, text) to authenticated;

-- ---------- Matsvinn (Business) ----------
create table public.waste_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  logged_at date not null default current_date,
  ingredient_id uuid,
  recipe_id uuid,
  -- Navn som øyeblikksbilde (ingrediens/oppskrift kan slettes senere)
  name text not null check (char_length(name) between 1 and 200),
  amount numeric(14, 4) not null check (amount > 0 and amount <= 100000000),
  unit public.measure_unit not null,
  -- Kostnad på tidspunktet (endres ikke når prisene endres)
  cost numeric(12, 2) not null default 0 check (cost >= 0),
  reason text not null check (reason in ('utgatt', 'odelagt', 'overproduksjon', 'tilberedning', 'tallerken', 'annet')),
  note text not null default '' check (char_length(note) <= 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ingredient_id is null or recipe_id is null),
  foreign key (ingredient_id, organization_id) references public.ingredients (id, organization_id) on delete set null (ingredient_id),
  foreign key (recipe_id, organization_id) references public.recipes (id, organization_id) on delete set null (recipe_id)
);
create index waste_logs_org_idx on public.waste_logs (organization_id, logged_at desc);
create trigger set_insert_metadata before insert on public.waste_logs for each row execute function public.set_insert_metadata();

alter table public.waste_logs enable row level security;
revoke all on public.waste_logs from public, anon, authenticated;
grant select, delete on public.waste_logs to authenticated;
create policy waste_select_member on public.waste_logs
  for select to authenticated using (public.is_org_member(organization_id));
create policy waste_delete_admin on public.waste_logs
  for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]));

-- Registrer svinn, og trekk ingrediensen fra lageret i samme transaksjon (valgfritt).
create or replace function public.register_waste(org uuid, entry jsonb, deduct_stock boolean default false)
returns uuid
language plpgsql
-- security definer: waste_logs har ingen direkte INSERT for klienter. Medlemskap og plan kontrolleres under.
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_ing uuid := nullif(entry ->> 'ingredient_id', '')::uuid;
  v_qty numeric := nullif(entry ->> 'stock_quantity', '')::numeric;
begin
  if not public.is_org_member(org) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if not public.org_has_feature(org, 'inventory') then
    raise exception using errcode = 'P0001', message = 'PLAN_FEATURE: Registrering av matsvinn krever Business.';
  end if;
  insert into public.waste_logs (id, organization_id, logged_at, ingredient_id, recipe_id, name, amount, unit, cost, reason, note)
  values (
    v_id, org,
    coalesce(nullif(entry ->> 'logged_at', '')::date, current_date),
    v_ing,
    nullif(entry ->> 'recipe_id', '')::uuid,
    entry ->> 'name',
    (entry ->> 'amount')::numeric,
    (entry ->> 'unit')::public.measure_unit,
    coalesce((entry ->> 'cost')::numeric, 0),
    entry ->> 'reason',
    coalesce(entry ->> 'note', '')
  );
  if deduct_stock and v_ing is not null and v_qty is not null and v_qty > 0 then
    insert into public.stock_movements (organization_id, ingredient_id, quantity, kind, unit_cost, note)
    values (org, v_ing, -v_qty, 'svinn', coalesce((entry ->> 'unit_cost')::numeric, 0), 'Svinn: ' || left(entry ->> 'reason', 40));
  end if;
  return v_id;
end;
$$;
revoke all on function public.register_waste(uuid, jsonb, boolean) from public, anon;
grant execute on function public.register_waste(uuid, jsonb, boolean) to authenticated;

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
        'suppliers', coalesce((select jsonb_agg(to_jsonb(sp)) from public.suppliers sp where sp.organization_id = o.id), '[]'::jsonb),
        'ingredients', coalesce((select jsonb_agg(to_jsonb(i)) from public.ingredients i where i.organization_id = o.id), '[]'::jsonb),
        'ingredient_prices', coalesce((select jsonb_agg(to_jsonb(ip)) from public.ingredient_prices ip where ip.organization_id = o.id), '[]'::jsonb),
        'recipes', coalesce((select jsonb_agg(to_jsonb(rc)) from public.recipes rc where rc.organization_id = o.id), '[]'::jsonb),
        'recipe_ingredients', coalesce((select jsonb_agg(to_jsonb(ri)) from public.recipe_ingredients ri where ri.organization_id = o.id), '[]'::jsonb),
        'equipment', coalesce((select jsonb_agg(to_jsonb(eq)) from public.equipment eq where eq.organization_id = o.id), '[]'::jsonb),
        'menus', coalesce((select jsonb_agg(to_jsonb(mn)) from public.menus mn where mn.organization_id = o.id), '[]'::jsonb),
        'stock_movements', coalesce((select jsonb_agg(to_jsonb(sm)) from public.stock_movements sm where sm.organization_id = o.id), '[]'::jsonb),
        'waste_logs', coalesce((select jsonb_agg(to_jsonb(wl)) from public.waste_logs wl where wl.organization_id = o.id), '[]'::jsonb),
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
