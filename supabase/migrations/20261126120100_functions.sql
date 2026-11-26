-- =====================================================================
-- Migrasjon 2/4: Funksjoner, triggere og serverfunksjoner (RPC)
--
-- Alle SECURITY DEFINER-funksjoner:
--  * har `set search_path = ''` og fullt kvalifiserte navn,
--  * kontrollerer selv hvem som kaller (auth.uid()) FØR de slår opp data,
--  * får EXECUTE fjernet fra PUBLIC/anon/authenticated og tildelt eksplisitt
--    i migrasjon 3.
--
-- Samtidighet: alle operasjoner som håndhever plangrenser eller endrer
-- medlemskap tar en transaksjonsbasert advisory lock per organisasjon
-- (lock_organization). Låsen er reentrant i samme transaksjon, og flere
-- organisasjoner låses alltid i stigende id-rekkefølge for å unngå deadlocks.
-- =====================================================================

-- ---------- Lås per organisasjon ----------
create or replace function public.lock_organization(org uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bakekalkulator.org:' || org::text, 0));
$$;

-- ---------- Tilgangshjelpere (brukes av RLS-policyer) ----------
create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_org_role(org uuid, roles public.organization_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid()) and m.role = any (roles)
  );
$$;

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.system_admins a where a.user_id = (select auth.uid()));
$$;

-- Nylig autentisering: JWT-claimet amr (signert av Supabase Auth) inneholder
-- tidspunkt for faktisk innlogging. Tokenfornyelse endrer ikke dette.
create or replace function public.recently_authenticated(max_age interval default interval '10 minutes')
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end
    ) a
    where jsonb_typeof(a) = 'object'
      and (a ->> 'method') in ('password', 'otp', 'magiclink', 'recovery', 'email/signup')
      and (a ->> 'timestamp') ~ '^[0-9]{1,12}$'
      and to_timestamp((a ->> 'timestamp')::bigint) >= now() - max_age
  );
$$;

-- ---------- Effektiv plan ----------
-- Prøveperiode gir Pro til trial_ends_at. Deretter Free, med mindre et betalt
-- abonnement er aktivt. Data slettes aldri – kun nye registreringer begrenses.
create or replace function public.effective_plan_internal(org uuid)
returns public.subscription_plan
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when s.status = 'active' and (s.current_period_end is null or s.current_period_end > now()) then s.plan
      when s.status = 'trialing' and s.trial_ends_at > now() then 'pro'::public.subscription_plan
      else 'free'::public.subscription_plan
    end
    from public.subscriptions s
    where s.organization_id = org
  ), 'free'::public.subscription_plan);
$$;

-- Offentlig variant: kun for medlemmer av organisasjonen (eller systemadmin).
create or replace function public.effective_plan(org uuid)
returns public.subscription_plan
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_org_member(org) or public.is_system_admin()) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return public.effective_plan_internal(org);
end;
$$;

-- ---------- Registrering: profil, organisasjon, medlemskap, prøveperiode og godkjenninger atomisk ----------
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
  v_org uuid;
begin
  v_name := left(coalesce(v_name, nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Bruker'), 200);
  v_org_name := left(case when v_type = 'business' then coalesce(v_org_name, v_name) else v_name end, 200);

  insert into public.profiles (id, full_name, email) values (new.id, v_name, new.email);

  insert into public.organizations (name, type, created_by)
  values (v_org_name, v_type, new.id)
  returning id into v_org;

  insert into public.organization_members (organization_id, user_id, role) values (v_org, new.id, 'owner');

  insert into public.subscriptions (organization_id, plan, status, trial_started_at, trial_ends_at)
  values (v_org, 'pro', 'trialing', now(), now() + interval '30 days');

  insert into public.user_settings (user_id, active_organization_id) values (new.id, v_org);

  insert into public.electricity_settings (organization_id, settings)
  values (v_org, jsonb_build_object('customerType', case when v_type = 'business' then 'bedrift' else 'privat' end));

  -- Godkjenning av vilkår og personvern registreres separat, med servertid, og bare
  -- for versjonen som faktisk er gjeldende. Klientens tidspunkt brukes aldri.
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Godkjenning av (ny versjon av) vilkår eller personvernerklæring, med servertid.
create or replace function public.accept_legal_document(doc text, doc_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;
  if not exists (select 1 from public.legal_documents d where d.document = doc and d.version = doc_version and d.is_current) then
    raise exception using errcode = 'P0001', message = 'INVALID: Ukjent eller utdatert dokumentversjon.';
  end if;
  insert into public.legal_acceptances (user_id, document, version) values (v_uid, doc, doc_version)
  on conflict (user_id, document, version) do nothing;
end;
$$;

-- ---------- Håndheving av plangrenser (serverside, transaksjonssikker) ----------
-- * Rader som allerede finnes (samme id, eller samme organization_id + local_id)
--   telles ikke: INSERT ... ON CONFLICT DO UPDATE/NOTHING blir da en redigering
--   eller et overhopp, ikke en ny registrering. Redigering er derfor alltid mulig,
--   også etter nedgradering.
-- * Nye rader: organisasjonen låses før telling, så samtidige transaksjoner
--   ikke kan passere grensen. Gjelder alle innganger (REST, RPC, import).
create or replace function public.enforce_plan_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.subscription_plan;
  f public.plan_features;
  v_count integer;
  v_exists boolean := false;
begin
  if tg_table_name = 'recipes' then
    select exists (select 1 from public.recipes r
                    where r.id = new.id or (new.local_id is not null and r.organization_id = new.organization_id and r.local_id = new.local_id))
      into v_exists;
  elsif tg_table_name = 'ingredients' then
    select exists (select 1 from public.ingredients i
                    where i.id = new.id or (new.local_id is not null and i.organization_id = new.organization_id and i.local_id = new.local_id))
      into v_exists;
  end if;
  if v_exists then
    return new;
  end if;

  perform public.lock_organization(new.organization_id);
  v_plan := public.effective_plan_internal(new.organization_id);
  select * into f from public.plan_features where plan = v_plan;

  -- Nestede if-er: PL/pgSQL må ikke evaluere kolonner som ikke finnes i tabellen.
  if tg_table_name = 'recipes' then
    if f.max_recipes is not null then
      select count(*) into v_count from public.recipes where organization_id = new.organization_id;
      if v_count >= f.max_recipes then
        raise exception using errcode = 'P0001',
          message = format('PLAN_LIMIT: %s-planen tillater maks %s oppskrifter.', initcap(v_plan::text), f.max_recipes);
      end if;
    end if;
  elsif tg_table_name = 'ingredients' then
    if f.max_ingredients is not null then
      select count(*) into v_count from public.ingredients where organization_id = new.organization_id;
      if v_count >= f.max_ingredients then
        raise exception using errcode = 'P0001',
          message = format('PLAN_LIMIT: %s-planen tillater maks %s ingredienser.', initcap(v_plan::text), f.max_ingredients);
      end if;
    end if;
  elsif tg_table_name = 'baking_history' then
    if (new.revenue is not null or new.profit is not null) and not coalesce(f.sales_calculator, false) then
      raise exception using errcode = 'P0001',
        message = 'PLAN_FEATURE: Registrering av salg og fortjeneste krever Plus eller Pro.';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_plan_limits before insert on public.recipes
  for each row execute function public.enforce_plan_limits();
create trigger enforce_plan_limits before insert on public.ingredients
  for each row execute function public.enforce_plan_limits();
create trigger enforce_plan_limits before insert on public.baking_history
  for each row execute function public.enforce_plan_limits();

-- Utløpte prøveperioder markeres som Free (kan kjøres med pg_cron).
-- Tilgang styres uansett av effective_plan_internal, så dette er kun for rapportering.
create or replace function public.expire_trials()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  update public.subscriptions
     set status = 'expired', plan = 'free'
   where status = 'trialing' and trial_ends_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------- Kontekst for innlogget bruker ----------
-- SECURITY DEFINER fordi den bruker effective_plan_internal; returnerer kun
-- data for innlogget bruker (filtrert på auth.uid()).
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

-- ---------- Medlemsadministrasjon (transaksjonssikker; roller endres aldri direkte i tabellen) ----------
create or replace function public.list_organization_members(org uuid)
returns table (user_id uuid, full_name text, email text, role public.organization_role, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_org_member(org) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return query
    select m.user_id, p.full_name, p.email, m.role, m.created_at
    from public.organization_members m
    left join public.profiles p on p.id = m.user_id
    where m.organization_id = org
    order by m.created_at;
end;
$$;

-- MERK: Legger til en allerede registrert bruker direkte. Anbefalt erstatning er
-- invitasjon med aksept fra mottakeren (se README). Tilgang og plan kontrolleres
-- før e-postadressen slås opp.
create or replace function public.add_member_by_email(org uuid, member_email text, member_role public.organization_role default 'member')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_target uuid;
  v_max integer;
  v_count integer;
  v_type public.organization_type;
begin
  if not public.has_org_role(org, array['owner', 'admin']::public.organization_role[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  perform public.lock_organization(org);
  -- Ny kontroll etter låsen: rollen kan ha blitt endret av en samtidig transaksjon
  if not public.has_org_role(org, array['owner', 'admin']::public.organization_role[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if member_role = 'owner' and not public.has_org_role(org, array['owner']::public.organization_role[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: Kun eier kan legge til eiere.';
  end if;
  select type into v_type from public.organizations where id = org;
  if v_type <> 'business' then
    raise exception using errcode = 'P0001', message = 'BUSINESS_ONLY: Kun bedrifter kan ha flere medlemmer.';
  end if;

  select f.max_members into v_max from public.plan_features f where f.plan = public.effective_plan_internal(org);
  select count(*) into v_count from public.organization_members where organization_id = org;
  if v_count >= coalesce(v_max, 1) then
    raise exception using errcode = 'P0001', message = 'PLAN_LIMIT: Planen tillater ikke flere medlemmer.';
  end if;

  select u.id into v_target from auth.users u where lower(u.email) = lower(btrim(member_email));
  if v_target is null then
    raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND: Brukeren må registrere seg før hen kan legges til.';
  end if;
  if v_target = v_uid then
    raise exception using errcode = 'P0001', message = 'INVALID: Du er allerede medlem.';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (org, v_target, member_role)
  on conflict (organization_id, user_id) do nothing;
  return v_target;
end;
$$;

create or replace function public.set_member_role(org uuid, member_id uuid, new_role public.organization_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_org_role(org, array['owner']::public.organization_role[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: Kun eier kan endre roller.';
  end if;
  perform public.lock_organization(org);
  if not public.has_org_role(org, array['owner']::public.organization_role[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: Kun eier kan endre roller.';
  end if;
  if member_id = (select auth.uid()) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: Du kan ikke endre din egen rolle.';
  end if;
  update public.organization_members set role = new_role
   where organization_id = org and user_id = member_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
end;
$$;

create or replace function public.remove_member(org uuid, member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_role public.organization_role;
begin
  -- Tilgang først: ikke-medlemmer skal ikke kunne lære hvem som er medlem.
  if not public.has_org_role(org, array['owner', 'admin']::public.organization_role[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  perform public.lock_organization(org);
  if member_id = (select auth.uid()) then
    raise exception using errcode = 'P0001', message = 'INVALID: Bruk «forlat organisasjon» for å fjerne deg selv.';
  end if;
  select role into v_target_role from public.organization_members where organization_id = org and user_id = member_id;
  if v_target_role is null then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
  if public.has_org_role(org, array['owner']::public.organization_role[])
     or (public.has_org_role(org, array['admin']::public.organization_role[]) and v_target_role = 'member') then
    delete from public.organization_members where organization_id = org and user_id = member_id;
  else
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
end;
$$;

create or replace function public.leave_organization(org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.organization_role;
  v_members integer;
  v_owners integer;
begin
  if not public.is_org_member(org) then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
  perform public.lock_organization(org);
  select role into v_role from public.organization_members where organization_id = org and user_id = v_uid;
  if v_role is null then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
  select count(*), count(*) filter (where role = 'owner') into v_members, v_owners
    from public.organization_members where organization_id = org;
  if v_members = 1 then
    raise exception using errcode = 'P0001', message = 'LAST_MEMBER: Du er eneste medlem. Slett kontoen for å fjerne organisasjonen.';
  end if;
  if v_role = 'owner' and v_owners = 1 then
    raise exception using errcode = 'P0001', message = 'LAST_OWNER: Gi en annen eierrollen før du forlater organisasjonen.';
  end if;
  -- Aktiv organisasjon nullstilles av fremmednøkkelen og flyttes av reassign_active_organization
  delete from public.organization_members where organization_id = org and user_id = v_uid;
end;
$$;

-- ---------- Sikkerhetsnett: en organisasjon med medlemmer har alltid en eier ----------
-- Fjernes siste eier på annen måte (f.eks. brukeren slettes i Supabase Dashboard),
-- forfremmes eldste administrator, ellers eldste medlem. Kjører etter fremmednøklene.
create or replace function public.ensure_org_has_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := old.organization_id;
  v_new uuid;
begin
  if not exists (select 1 from public.organizations o where o.id = v_org) then
    return null; -- organisasjonen slettes
  end if;
  if exists (select 1 from public.organization_members m where m.organization_id = v_org and m.role = 'owner') then
    return null;
  end if;
  select m.user_id into v_new from public.organization_members m
   where m.organization_id = v_org
   order by (m.role = 'admin') desc, m.created_at, m.user_id
   limit 1;
  if v_new is not null then
    update public.organization_members set role = 'owner' where organization_id = v_org and user_id = v_new;
  end if;
  return null;
end;
$$;

create trigger zz_ensure_org_has_owner
  after update of role or delete on public.organization_members
  for each row execute function public.ensure_org_has_owner();

-- ---------- Aktiv organisasjon når et medlemskap forsvinner ----------
-- Fremmednøkkelen (active_organization_id, user_id) -> organization_members setter
-- feltet til null når medlemskapet slettes (også når organisasjonen slettes).
-- Denne triggeren velger da brukerens eldste gjenværende medlemskap, om noe finnes.
-- Hoppes over når selve brukeren slettes (kaskade fra auth.users).
create or replace function public.reassign_active_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from auth.users u where u.id = old.user_id) then
    return null;
  end if;
  update public.user_settings s
     set active_organization_id = (
       select m.organization_id from public.organization_members m
        where m.user_id = old.user_id
        order by m.created_at, m.organization_id
        limit 1)
   where s.user_id = old.user_id
     and (s.active_organization_id is null or s.active_organization_id = old.organization_id);
  return null;
end;
$$;

-- Navnet starter med zz_ slik at den kjører etter fremmednøkkelens interne triggere.
create trigger zz_reassign_active_organization
  after delete on public.organization_members
  for each row execute function public.reassign_active_organization();

-- ---------- Personvern: sletting av egen konto ----------
-- Krever nylig innlogging (amr i JWT, maks 10 minutter) OG teksten «SLETT».
-- * Organisasjoner der brukeren er eneste medlem slettes med alle data.
-- * I organisasjoner med flere medlemmer overføres eierskap (eldste admin,
--   ellers eldste medlem) før brukeren fjernes. Organisasjonens data beholdes;
--   created_by i felles data settes til NULL av fremmednøklene.
-- * Organisasjonene låses i stigende id-rekkefølge (samme rekkefølge overalt).
create or replace function public.delete_my_account(confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  r record;
  v_new_owner uuid;
  v_deleted_orgs integer := 0;
  v_transferred integer := 0;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;
  if confirmation is distinct from 'SLETT' then
    raise exception using errcode = 'P0001', message = 'CONFIRMATION_REQUIRED: Skriv SLETT for å bekrefte.';
  end if;
  if not public.recently_authenticated(interval '10 minutes') then
    raise exception using errcode = '42501', message = 'REAUTH_REQUIRED: Logg inn på nytt med passord for å bekrefte slettingen.';
  end if;

  for v_org in
    select m.organization_id from public.organization_members m where m.user_id = v_uid order by m.organization_id
  loop
    perform public.lock_organization(v_org);
  end loop;

  for r in
    select m.organization_id, m.role,
           (select count(*) from public.organization_members x where x.organization_id = m.organization_id) as members,
           (select count(*) from public.organization_members x where x.organization_id = m.organization_id and x.role = 'owner') as owners
    from public.organization_members m
    where m.user_id = v_uid
    order by m.organization_id
  loop
    if r.members = 1 then
      delete from public.organizations where id = r.organization_id;
      v_deleted_orgs := v_deleted_orgs + 1;
    elsif r.role = 'owner' and r.owners = 1 then
      select x.user_id into v_new_owner
        from public.organization_members x
       where x.organization_id = r.organization_id and x.user_id <> v_uid
       order by (x.role = 'admin') desc, x.created_at, x.user_id
       limit 1;
      update public.organization_members set role = 'owner'
       where organization_id = r.organization_id and user_id = v_new_owner;
      v_transferred := v_transferred + 1;
    end if;
  end loop;

  delete from auth.users where id = v_uid; -- kaskaderer profil, medlemskap, innstillinger, godkjenninger
  return jsonb_build_object('deleted_organizations', v_deleted_orgs, 'transferred_ownership', v_transferred);
end;
$$;

-- ---------- Personvern: eksport av egne data (RLS gjelder) ----------
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
        'ingredients', coalesce((select jsonb_agg(to_jsonb(i)) from public.ingredients i where i.organization_id = o.id), '[]'::jsonb),
        'recipes', coalesce((select jsonb_agg(to_jsonb(rc)) from public.recipes rc where rc.organization_id = o.id), '[]'::jsonb),
        'recipe_ingredients', coalesce((select jsonb_agg(to_jsonb(ri)) from public.recipe_ingredients ri where ri.organization_id = o.id), '[]'::jsonb),
        'equipment', coalesce((select jsonb_agg(to_jsonb(eq)) from public.equipment eq where eq.organization_id = o.id), '[]'::jsonb),
        'baking_history', coalesce((select jsonb_agg(to_jsonb(h)) from public.baking_history h where h.organization_id = o.id), '[]'::jsonb)
      ))
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
      where m.user_id = v_uid
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------- Lagre oppskrift med linjer atomisk (RLS og kolonnerettigheter gjelder) ----------
-- Eksisterende oppskrift oppdateres med UPDATE (ingen INSERT-trigger, ingen plangrense),
-- ny oppskrift opprettes med INSERT (plangrense gjelder).
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
    yield_count = (recipe ->> 'yield_count')::integer,
    steps = coalesce(array(select jsonb_array_elements_text(recipe -> 'steps')), '{}'),
    rise_minutes = coalesce((recipe ->> 'rise_minutes')::integer, 0),
    bake_minutes = coalesce((recipe ->> 'bake_minutes')::integer, 0),
    store_price_per_item = coalesce((recipe ->> 'store_price_per_item')::numeric, 0),
    notes = coalesce(recipe ->> 'notes', ''),
    energy = coalesce(recipe -> 'energy', '{}'::jsonb)
  where id = v_id and organization_id = org;

  if not found then
    -- Finnes id-en i en annen organisasjon, avvises den (avslører ikke innholdet)
    insert into public.recipes (id, organization_id, name, type, yield_count, steps, rise_minutes, bake_minutes, store_price_per_item, notes, energy)
    values (
      v_id, org,
      recipe ->> 'name',
      coalesce(nullif(recipe ->> 'type', ''), 'annet')::public.bake_type,
      (recipe ->> 'yield_count')::integer,
      coalesce(array(select jsonb_array_elements_text(recipe -> 'steps')), '{}'),
      coalesce((recipe ->> 'rise_minutes')::integer, 0),
      coalesce((recipe ->> 'bake_minutes')::integer, 0),
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

-- ---------- Lagre ingrediens (redigering alltid mulig; ny ingrediens følger plangrensen) ----------
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
    price_updated = coalesce(nullif(ingredient ->> 'price_updated', '')::date, current_date)
  where id = v_id and organization_id = org;
  if not found then
    insert into public.ingredients (id, organization_id, name, category, package_size, unit, price, store, price_updated)
    values (
      v_id, org, ingredient ->> 'name', coalesce(ingredient ->> 'category', ''),
      (ingredient ->> 'package_size')::numeric, (ingredient ->> 'unit')::public.measure_unit,
      (ingredient ->> 'price')::numeric, coalesce(ingredient ->> 'store', ''),
      coalesce(nullif(ingredient ->> 'price_updated', '')::date, current_date)
    );
  end if;
  return v_id;
end;
$$;

-- ---------- Import av lokale data: idempotent og atomisk ----------
-- * Krever gyldig, ikke-tom local_id (lokal id fra nettleseren).
-- * Organisasjonen låses, slik at samtidige importer ikke kan lage duplikater
--   eller passere plangrensen.
-- * Det som allerede finnes hoppes over FØR plangrensen kontrolleres – gjentatt
--   import fungerer derfor også når grensen er nådd.
-- * Hele importen er én transaksjon: feiler noe, lagres ingenting.
-- * Importerer oppskrifter og ingredienser. Bakehistorikk, utstyr og innstillinger
--   importeres ikke (se README).
-- * SECURITY DEFINER for å kunne låse organisasjonen. Medlemskap kontrolleres først,
--   og alle skrivinger er låst til den kontrollerte organisasjonen. Plangrense-,
--   metadata- og identitetstriggerne gjelder fortsatt (created_by = auth.uid()).
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
  pos integer;
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
    insert into public.ingredients (organization_id, local_id, name, category, package_size, unit, price, store, price_updated)
    values (
      org, v_local, it ->> 'name', coalesce(it ->> 'category', ''),
      (it ->> 'package_size')::numeric, (it ->> 'unit')::public.measure_unit, (it ->> 'price')::numeric,
      coalesce(it ->> 'store', ''), coalesce(nullif(it ->> 'price_updated', '')::date, current_date)
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
    insert into public.recipes (organization_id, local_id, name, type, yield_count, steps, rise_minutes, bake_minutes, store_price_per_item, notes, energy)
    values (
      org, v_local, it ->> 'name',
      coalesce(nullif(it ->> 'type', ''), 'annet')::public.bake_type,
      (it ->> 'yield_count')::integer,
      coalesce(array(select jsonb_array_elements_text(it -> 'steps')), '{}'),
      coalesce((it ->> 'rise_minutes')::integer, 0),
      coalesce((it ->> 'bake_minutes')::integer, 0),
      coalesce((it ->> 'store_price_per_item')::numeric, 0),
      coalesce(it ->> 'notes', ''),
      coalesce(it -> 'energy', '{}'::jsonb)
    )
    on conflict (organization_id, local_id) do nothing
    returning id into v_id;

    if v_id is null then
      rec_skip := rec_skip + 1;
    else
      rec_new := rec_new + 1;
      pos := 0;
      for ln in select * from jsonb_array_elements(coalesce(it -> 'ingredients', '[]'::jsonb)) loop
        v_ing := null;
        select i.id into v_ing from public.ingredients i
         where i.organization_id = org and i.local_id = nullif(btrim(coalesce(ln ->> 'ingredient_local_id', '')), '');
        insert into public.recipe_ingredients (organization_id, recipe_id, ingredient_id, position, amount, unit)
        values (org, v_id, v_ing, pos, (ln ->> 'amount')::numeric, (ln ->> 'unit')::public.measure_unit);
        pos := pos + 1;
      end loop;
    end if;
  end loop;

  return jsonb_build_object(
    'ingredients_inserted', ing_new, 'ingredients_skipped', ing_skip,
    'recipes_inserted', rec_new, 'recipes_skipped', rec_skip
  );
end;
$$;

-- ---------- Offentlige satser: entydig sats for en dato ----------
-- Kun verifiserte satser (verified_at satt) brukes automatisk.
-- Overlapp for samme (kode, område, kundetype) er umulig (EXCLUDE-begrensning).
-- Gjelder flere kombinasjoner samtidig, vinner den mest spesifikke:
--   område + kundetype (3) > område (2) > kundetype (1) > generell (0).
-- Samme prioritering brukes i appen (src/utils/tariffs.ts).
create or replace function public.resolve_electricity_tariff(
  tariff_code text, on_date date default current_date, price_area text default null, cust_type text default null)
returns setof public.electricity_tariffs
language sql
stable
security invoker
set search_path = ''
as $$
  select t.* from public.electricity_tariffs t
  where t.code = tariff_code
    and t.verified_at is not null
    and t.valid_from <= on_date and (t.valid_to is null or t.valid_to >= on_date)
    and (t.area is null or t.area = price_area)
    and (t.customer_type is null or t.customer_type = cust_type)
  order by (case when t.area is not null then 2 else 0 end) + (case when t.customer_type is not null then 1 else 0 end) desc
  limit 1;
$$;

-- Kun gyldige og verifiserte satser for en dato.
create or replace function public.active_electricity_tariffs(on_date date default current_date)
returns setof public.electricity_tariffs
language sql
stable
security invoker
set search_path = ''
as $$
  select * from public.electricity_tariffs t
  where t.verified_at is not null
    and t.valid_from <= on_date and (t.valid_to is null or t.valid_to >= on_date)
  order by t.code, t.valid_from desc;
$$;

-- ---------- Systemadministrasjon (kun aggregater – ingen tilgang til oppskrifter o.l.) ----------
create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_system_admin() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return jsonb_build_object(
    'customers', (select count(*) from public.organizations),
    'private_customers', (select count(*) from public.organizations where type = 'private'),
    'business_customers', (select count(*) from public.organizations where type = 'business'),
    'users', (select count(*) from public.profiles),
    'active_trials', (select count(*) from public.subscriptions where status = 'trialing' and trial_ends_at > now()),
    'expired_trials', (select count(*) from public.subscriptions where (status = 'trialing' and trial_ends_at <= now()) or status = 'expired'),
    'paid_active', (select count(*) from public.subscriptions where status = 'active' and plan <> 'free'),
    'effective_plans', (
      select coalesce(jsonb_object_agg(p, n), '{}'::jsonb) from (
        select public.effective_plan_internal(o.id)::text as p, count(*) as n
        from public.organizations o group by 1
      ) x
    )
  );
end;
$$;

create or replace function public.admin_list_subscriptions(max_rows integer default 200, skip_rows integer default 0)
returns table (
  organization_id uuid, organization_name text, organization_type public.organization_type,
  member_count bigint, plan public.subscription_plan, status public.subscription_status,
  effective_plan public.subscription_plan, trial_ends_at timestamptz, current_period_end timestamptz, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_system_admin() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return query
    select o.id, o.name, o.type,
           (select count(*) from public.organization_members m where m.organization_id = o.id),
           s.plan, s.status, public.effective_plan_internal(o.id), s.trial_ends_at, s.current_period_end, o.created_at
    from public.organizations o
    left join public.subscriptions s on s.organization_id = o.id
    order by o.created_at desc
    limit least(greatest(max_rows, 1), 1000) offset greatest(skip_rows, 0);
end;
$$;

-- Manuell abonnementsendring frem til Stripe er på plass.
create or replace function public.admin_set_subscription(org uuid, new_plan public.subscription_plan, new_status public.subscription_status, period_end timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_system_admin() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  update public.subscriptions
     set plan = new_plan, status = new_status, current_period_end = period_end
   where organization_id = org;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
end;
$$;

create or replace function public.admin_upsert_tariff(tariff jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid := coalesce(nullif(tariff ->> 'id', '')::uuid, gen_random_uuid());
begin
  if not public.is_system_admin() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  insert into public.electricity_tariffs as t (id, code, description, value, unit, area, customer_type, valid_from, valid_to, source_url, verified_at, notes)
  values (
    v_id, tariff ->> 'code', tariff ->> 'description', (tariff ->> 'value')::numeric, tariff ->> 'unit',
    nullif(tariff ->> 'area', ''), nullif(tariff ->> 'customer_type', ''),
    (tariff ->> 'valid_from')::date, nullif(tariff ->> 'valid_to', '')::date,
    tariff ->> 'source_url', nullif(tariff ->> 'verified_at', '')::date, nullif(tariff ->> 'notes', '')
  )
  on conflict (id) do update set
    code = excluded.code, description = excluded.description, value = excluded.value, unit = excluded.unit,
    area = excluded.area, customer_type = excluded.customer_type, valid_from = excluded.valid_from,
    valid_to = excluded.valid_to, source_url = excluded.source_url, verified_at = excluded.verified_at, notes = excluded.notes;
  return v_id;
end;
$$;

create or replace function public.admin_delete_tariff(tariff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_system_admin() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  delete from public.electricity_tariffs where id = tariff_id;
end;
$$;
