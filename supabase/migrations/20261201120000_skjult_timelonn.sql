-- =====================================================================
-- Rett i lomma – Matkalkulator
-- Migrasjon 10: Timelønn bare for eier og administrator
--
-- Lønnsdetaljene (timelønn, feriepenger, pensjon, arbeidsgiveravgift, andre
-- personalkostnader) flyttes fra cost_settings til staff_wages, som bare
-- eier og administrator kan lese. Medlemmer får bare rollenavn og ferdig
-- beregnet timekostnad i cost_settings, som trengs for å regne kostnaden
-- i oppskrifter og menyer. Appen viser ikke timekostnaden til medlemmer.
--
-- Eksisterende data flyttes over uten tap. Krever migrasjon 6.
-- =====================================================================

create table public.staff_wages (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  -- Rollene med alle satser, slik administrator registrerte dem
  roles jsonb not null default '[]'::jsonb check (jsonb_typeof(roles) = 'array' and pg_column_size(roles) <= 200000),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.staff_wages for each row execute function public.set_updated_at();
create trigger protect_row_identity before update on public.staff_wages for each row execute function public.protect_row_identity();
create trigger set_updated_by before insert or update on public.staff_wages for each row execute function public.set_updated_by();

alter table public.staff_wages enable row level security;
revoke all on public.staff_wages from public, anon, authenticated;
grant select on public.staff_wages to authenticated;
-- Bare eier og administrator kan lese. Endring skjer bare via save_cost_settings.
create policy staff_wages_select_admin on public.staff_wages
  for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]));

-- Timekostnad for en rolle (samme formel som utils/staffCosts.ts):
-- feriepenger og pensjon av timelønn, arbeidsgiveravgift av lønn + feriepenger +
-- pensjon, andre kostnader av timelønn. «Ferdig» bruker oppgitt timekostnad.
create or replace function public.staff_role_hourly_cost(r jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  with v as (
    select
      greatest(coalesce((r ->> 'hourlyWage')::numeric, 0), 0) as wage,
      greatest(coalesce((r ->> 'holidayPayPercent')::numeric, 0), 0) / 100 as hol,
      greatest(coalesce((r ->> 'pensionPercent')::numeric, 0), 0) / 100 as pen,
      greatest(coalesce((r ->> 'employerTaxPercent')::numeric, 0), 0) / 100 as aga,
      greatest(coalesce((r ->> 'otherPercent')::numeric, 0), 0) / 100 as oth,
      greatest(coalesce((r ->> 'fixedHourlyCost')::numeric, 0), 0) as fixed
  )
  select round(case when r ->> 'mode' = 'ferdig' then fixed
                    else wage * (1 + hol + pen) * (1 + aga) + wage * oth end, 4)
  from v;
$$;
revoke all on function public.staff_role_hourly_cost(jsonb) from public, anon, authenticated;

-- Roller slik medlemmer ser dem: id, navn og ferdig timekostnad, ingen lønnsdetaljer
create or replace function public.staff_roles_public(roles jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', left(coalesce(x ->> 'id', ''), 100),
    'name', left(coalesce(x ->> 'name', ''), 200),
    'mode', 'ferdig',
    'fixedHourlyCost', public.staff_role_hourly_cost(x)
  )), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(roles) = 'array' then roles else '[]'::jsonb end) x
  where jsonb_typeof(x) = 'object';
$$;
revoke all on function public.staff_roles_public(jsonb) from public, anon, authenticated;

-- Flytt eksisterende lønnsdetaljer og fjern dem fra cost_settings
insert into public.staff_wages (organization_id, roles, updated_by)
select c.organization_id, c.settings -> 'staffRoles', c.updated_by
from public.cost_settings c
where jsonb_typeof(c.settings -> 'staffRoles') = 'array' and jsonb_array_length(c.settings -> 'staffRoles') > 0
on conflict (organization_id) do nothing;

update public.cost_settings c
   set settings = c.settings || jsonb_build_object('staffRoles', public.staff_roles_public(c.settings -> 'staffRoles'))
 where jsonb_typeof(c.settings -> 'staffRoles') = 'array';

-- Lagring: lønnsdetaljer til staff_wages, rollenavn og timekostnad til cost_settings
create or replace function public.save_cost_settings(org uuid, settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_roles jsonb := case when jsonb_typeof(settings -> 'staffRoles') = 'array' then settings -> 'staffRoles' else '[]'::jsonb end;
begin
  if not public.has_org_role(org, array['owner', 'admin']::public.organization_role[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: Bare eier eller administrator kan endre personal- og driftskostnader.';
  end if;
  if jsonb_typeof(coalesce(settings, 'null'::jsonb)) <> 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID: Ugyldige kostnadsinnstillinger.';
  end if;
  insert into public.staff_wages (organization_id, roles)
  values (org, v_roles)
  on conflict (organization_id) do update set roles = excluded.roles;

  insert into public.cost_settings (organization_id, settings)
  values (org, settings || jsonb_build_object('staffRoles', public.staff_roles_public(v_roles)))
  on conflict (organization_id) do update set settings = excluded.settings;
end;
$$;

-- Eksport: lønnsdetaljene bare for eier og administrator (RLS gjelder i export_my_data)
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
        'staff_wages', (select w.roles from public.staff_wages w where w.organization_id = o.id),
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
