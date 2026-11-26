-- =====================================================================
-- Rett i lomma – Bakekalkulator
-- Migrasjon 1/4: Grunnskjema (typer, tabeller, constraints, indekser)
--
-- Prinsipper:
--  * UUID som primærnøkkel overalt.
--  * Alle kundedata tilhører en organisasjon (organization_id).
--    Privatpersoner får en egen "privat" organisasjon med én eier.
--  * Sammensatte fremmednøkler (id, organization_id) sikrer at
--    oppskriftslinjer og historikk aldri kan peke på en annen kundes data.
--  * baking_history er øyeblikksbilder og kan ikke endres.
--  * Strømpriser kan være negative (spotpris under null), så strømrelaterte
--    beløp i historikken har ingen nedre grense.
-- =====================================================================

-- ---------- Utvidelser ----------
-- btree_gist: kreves for EXCLUDE-begrensningen som hindrer overlappende satser.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- ---------- Typer ----------
create type public.organization_type as enum ('private', 'business');
create type public.organization_role as enum ('owner', 'admin', 'member');
create type public.subscription_plan as enum ('free', 'plus', 'pro');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'expired');
create type public.bake_type as enum ('brod', 'rundstykker', 'kake', 'pizza', 'boller', 'annet');
create type public.measure_unit as enum ('g', 'kg', 'ml', 'dl', 'l', 'stk');

-- ---------- Felles trigger for updated_at ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- Brukere og organisasjoner ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 200),
  email text check (email is null or char_length(email) <= 320),
  -- Godkjenning av vilkår/personvern registreres i legal_acceptances (versjon + servertid)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  type public.organization_type not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.organization_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

-- Systemadministratorer styres kun fra serversiden (SQL editor / service role).
-- Ingen klient har lese- eller skrivetilgang til tabellen.
create table public.system_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

-- ---------- Vilkår og personvernerklæring ----------
-- Publiserte dokumentversjoner. Godkjenninger lagres separat per dokument og
-- versjon med servertid. Klienten kan ikke endre eller slette godkjenninger.
create table public.legal_documents (
  document text not null check (document in ('terms', 'privacy')),
  version text not null check (version ~ '^[A-Za-z0-9._-]{1,40}$'),
  url text not null check (char_length(url) between 1 and 300),
  published_at timestamptz not null default now(),
  is_current boolean not null default false,
  primary key (document, version)
);
create unique index legal_documents_one_current on public.legal_documents (document) where is_current;

create table public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document text not null,
  version text not null,
  accepted_at timestamptz not null default now(),
  foreign key (document, version) references public.legal_documents (document, version),
  unique (user_id, document, version)
);
create index legal_acceptances_user_idx on public.legal_acceptances (user_id);

-- ---------- Abonnement ----------
create table public.plan_features (
  plan public.subscription_plan primary key,
  max_recipes integer check (max_recipes is null or max_recipes > 0),        -- null = ubegrenset
  max_ingredients integer check (max_ingredients is null or max_ingredients > 0),
  max_members integer not null default 1 check (max_members >= 1),
  sales_calculator boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  plan public.subscription_plan not null default 'free',
  status public.subscription_status not null default 'trialing',
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  -- Klargjort for Stripe (ikke i bruk ennå)
  external_customer_id text,
  external_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (trial_ends_at is null or trial_started_at is null or trial_ends_at > trial_started_at),
  check (status <> 'trialing' or (trial_started_at is not null and trial_ends_at is not null))
);
create index subscriptions_trial_idx on public.subscriptions (status, trial_ends_at);

-- ---------- Innstillinger ----------
create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Aktiv organisasjon MÅ være en der brukeren er medlem. Håndheves av den sammensatte
  -- fremmednøkkelen under (gjelder alle skrivinger, også fra serveren). Fjernes
  -- medlemskapet eller organisasjonen, settes feltet til null (og en trigger velger
  -- et annet medlemskap, se reassign_active_organization).
  active_organization_id uuid,
  locale text not null default 'nb-NO' check (char_length(locale) between 2 and 20),
  currency text not null default 'NOK' check (currency ~ '^[A-Z]{3}$'),
  bakes_per_month numeric(7, 2) not null default 4 check (bakes_per_month between 0 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (active_organization_id, user_id)
    references public.organization_members (organization_id, user_id)
    on delete set null (active_organization_id)
);

-- Strømprisoppsett per organisasjon (samme struktur som PriceSettings i appen).
create table public.electricity_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Offentlige satser og støtteordninger med gyldighetsperiode og kilde.
-- Leses av alle, endres kun av systemadministrator via egen funksjon.
create table public.electricity_tariffs (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z0-9_]{2,60}$'),
  description text not null check (char_length(description) between 1 and 300),
  value numeric(14, 6) not null,
  unit text not null check (char_length(unit) between 1 and 40),
  area text check (area in ('NO1', 'NO2', 'NO3', 'NO4', 'NO5')),
  customer_type text check (customer_type in ('privat', 'bedrift')),
  valid_from date not null,
  valid_to date,
  source_url text not null check (source_url ~ '^https://'),
  verified_at date, -- NULL = kilden er ikke kontrollert; slike satser brukes ikke automatisk
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  -- Ingen overlappende gyldighetsperioder for samme kode + område + kundetype.
  --  * NULL i area/customer_type betyr «alle» og behandles som egen verdi ('*'),
  --    slik at en generell sats og en områdespesifikk sats kan gjelde samtidig.
  --  * NULL i valid_to betyr ubestemt tid (daterange uten øvre grense).
  --  * Grensene er inklusive ('[]'), likt valid_from <= dato <= valid_to i appen.
  --  * EXCLUDE håndheves via indeks og er trygg ved samtidige transaksjoner.
  constraint electricity_tariffs_no_overlap exclude using gist (
    code with =,
    (coalesce(area, '*')) with =,
    (coalesce(customer_type, '*')) with =,
    daterange(valid_from, valid_to, '[]') with &&
  )
);
create index electricity_tariffs_lookup_idx on public.electricity_tariffs (code, valid_from, valid_to);

-- ---------- Kundedata ----------
create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  local_id text check (local_id is null or char_length(local_id) <= 100), -- id fra lokal lagring (hindrer duplikat ved import)
  name text not null check (char_length(name) between 1 and 200),
  category text not null default '' check (char_length(category) <= 100),
  package_size numeric(14, 4) not null check (package_size > 0),
  unit public.measure_unit not null,
  price numeric(12, 2) not null check (price >= 0),
  store text not null default '' check (char_length(store) <= 200),
  price_updated date not null default current_date,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, local_id),
  unique (id, organization_id)
);
create index ingredients_org_idx on public.ingredients (organization_id);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  local_id text check (local_id is null or char_length(local_id) <= 100),
  name text not null check (char_length(name) between 1 and 200),
  type public.bake_type not null default 'annet',
  yield_count integer not null check (yield_count between 1 and 100000),
  steps text[] not null default '{}',
  rise_minutes integer not null default 0 check (rise_minutes between 0 and 10080),
  bake_minutes integer not null default 0 check (bake_minutes between 0 and 1440),
  store_price_per_item numeric(12, 2) not null default 0 check (store_price_per_item >= 0),
  notes text not null default '' check (char_length(notes) <= 5000),
  energy jsonb not null default '{}'::jsonb check (jsonb_typeof(energy) = 'object'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, local_id),
  unique (id, organization_id)
);
create index recipes_org_idx on public.recipes (organization_id);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  recipe_id uuid not null,
  ingredient_id uuid,
  position integer not null default 0 check (position >= 0),
  amount numeric(14, 4) not null check (amount >= 0),
  unit public.measure_unit not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (recipe_id, organization_id) references public.recipes (id, organization_id) on delete cascade,
  -- Sletter man en ingrediens, beholdes linjen (vises som ukjent ingrediens)
  foreign key (ingredient_id, organization_id) references public.ingredients (id, organization_id) on delete set null (ingredient_id)
);
create index recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id, position);
create index recipe_ingredients_ingredient_idx on public.recipe_ingredients (ingredient_id);

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  watt numeric(10, 2) not null check (watt > 0 and watt <= 100000),
  minutes numeric(10, 2) not null default 0 check (minutes between 0 and 10080),
  power_factor_percent numeric(5, 2) not null default 100 check (power_factor_percent between 0 and 100),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index equipment_org_idx on public.equipment (organization_id);

-- Øyeblikksbilder: alle beløp er kopiert inn ved lagring.
create table public.baking_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  baked_at timestamptz not null default now(),
  recipe_id uuid,
  recipe_name text not null check (char_length(recipe_name) between 1 and 200),
  type public.bake_type not null default 'annet',
  count integer not null check (count between 1 and 1000000),
  kwh numeric(12, 4) not null check (kwh >= 0),
  price_per_kwh numeric(12, 6) not null,          -- kan være negativ (negativ spotpris)
  electricity_cost numeric(12, 2) not null,       -- kan være negativ
  ingredient_cost numeric(12, 2) not null check (ingredient_cost >= 0),
  total_cost numeric(12, 2) not null,             -- kan være negativ ved negativ strømkostnad
  cost_per_item numeric(12, 4) not null,          -- kan være negativ
  store_price_per_item numeric(12, 2) not null default 0 check (store_price_per_item >= 0),
  revenue numeric(12, 2) check (revenue is null or revenue >= 0),
  profit numeric(12, 2),
  note text not null default '' check (char_length(note) <= 2000),
  snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (recipe_id, organization_id) references public.recipes (id, organization_id) on delete set null (recipe_id)
);
create index baking_history_org_date_idx on public.baking_history (organization_id, baked_at desc);

-- ---------- updated_at-triggere ----------
create trigger set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.organization_members for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.plan_features for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.user_settings for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.electricity_settings for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.electricity_tariffs for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.ingredients for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.recipes for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.recipe_ingredients for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.equipment for each row execute function public.set_updated_at();

-- ---------- Historikk kan ikke endres ----------
-- Eneste tillatte endringer er de fremmednøklene gjør ved sletting (ON DELETE SET NULL):
--  * recipe_id: eksisterende verdi -> NULL (oppskriften slettes)
--  * created_by: eksisterende verdi -> NULL (brukerkontoen slettes)
-- Ingen av feltene kan endres til en annen UUID, og alle andre endringer blokkeres.
-- Klienter har i tillegg ingen UPDATE-rettighet (se migrasjon 3).
create or replace function public.prevent_history_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'recipe_id' - 'created_by') is distinct from (to_jsonb(old) - 'recipe_id' - 'created_by')
     or (new.recipe_id is distinct from old.recipe_id and new.recipe_id is not null)
     or (new.created_by is distinct from old.created_by and new.created_by is not null) then
    raise exception using errcode = 'P0001', message = 'HISTORY_IMMUTABLE: Bakehistorikk er et øyeblikksbilde og kan ikke endres.';
  end if;
  return new;
end;
$$;
create trigger prevent_history_update before update on public.baking_history
  for each row execute function public.prevent_history_update();


-- ---------- Uforanderlige identitetsfelt ----------
-- id, organization_id, user_id, created_at og local_id kan ikke endres etter opprettelse,
-- og recipe_ingredients.recipe_id kan ikke flyttes. created_by kan bare gå til NULL
-- (fremmednøkkelen ON DELETE SET NULL når en bruker slettes) – aldri til en annen bruker.
-- Gjelder alle skrivinger, også SECURITY DEFINER-funksjoner og service role.
-- Klienter har i tillegg kun UPDATE-rettighet på redigerbare kolonner (migrasjon 3).
create or replace function public.protect_row_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb := to_jsonb(old);
  k text;
begin
  foreach k in array array['id', 'organization_id', 'user_id', 'created_at', 'local_id'] loop
    if n ? k and n -> k is distinct from o -> k then
      raise exception using errcode = 'P0001', message = format('IMMUTABLE: Feltet %s kan ikke endres.', k);
    end if;
  end loop;
  if tg_table_name = 'recipe_ingredients' and n -> 'recipe_id' is distinct from o -> 'recipe_id' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE: Feltet recipe_id kan ikke endres.';
  end if;
  if n ? 'created_by' and n -> 'created_by' is distinct from o -> 'created_by' and n -> 'created_by' <> 'null'::jsonb then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE: Feltet created_by kan ikke endres.';
  end if;
  return new;
end;
$$;

create trigger protect_row_identity before update on public.profiles for each row execute function public.protect_row_identity();
create trigger protect_row_identity before update on public.organizations for each row execute function public.protect_row_identity();
create trigger protect_row_identity before update on public.organization_members for each row execute function public.protect_row_identity();
create trigger protect_row_identity before update on public.subscriptions for each row execute function public.protect_row_identity();
create trigger protect_row_identity before update on public.user_settings for each row execute function public.protect_row_identity();
create trigger protect_row_identity before update on public.electricity_settings for each row execute function public.protect_row_identity();
create trigger protect_row_identity before update on public.ingredients for each row execute function public.protect_row_identity();
create trigger protect_row_identity before update on public.recipes for each row execute function public.protect_row_identity();
create trigger protect_row_identity before update on public.recipe_ingredients for each row execute function public.protect_row_identity();
create trigger protect_row_identity before update on public.equipment for each row execute function public.protect_row_identity();

-- ---------- Serverstyrte metadata ved opprettelse ----------
-- created_at settes alltid til servertid. created_by settes til innlogget bruker
-- (auth.uid()), slik at klienten ikke kan oppgi en annen bruker.
create or replace function public.set_insert_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  patch jsonb := jsonb_build_object('created_at', now());
begin
  if v_uid is not null then
    patch := patch || jsonb_build_object('created_by', v_uid);
  end if;
  return jsonb_populate_record(new, patch); -- nøkler tabellen ikke har, ignoreres
end;
$$;

create trigger set_insert_metadata before insert on public.ingredients for each row execute function public.set_insert_metadata();
create trigger set_insert_metadata before insert on public.recipes for each row execute function public.set_insert_metadata();
create trigger set_insert_metadata before insert on public.recipe_ingredients for each row execute function public.set_insert_metadata();
create trigger set_insert_metadata before insert on public.equipment for each row execute function public.set_insert_metadata();
create trigger set_insert_metadata before insert on public.baking_history for each row execute function public.set_insert_metadata();

-- electricity_settings.updated_by settes av serveren, aldri av klienten.
create or replace function public.set_updated_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger set_updated_by before insert or update on public.electricity_settings
  for each row execute function public.set_updated_by();
