// PGlite-tester for sikkerhetsrettelsene (runde 3). Tester som krever samtidige
// transaksjoner ligger i tests/pg/ og kjøres mot ekte PostgreSQL (npm run test:pg).
//
// «Direkte REST-kall» simuleres med SQL som rollen authenticated – det er nøyaktig
// det PostgREST utfører på vegne av klienten (samme rolle, samme JWT-claims, samme RLS).
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './pgHarness'

let t: TestDb
let free: string // bruker som nedgraderes til Free
let freeOrg: string
let multi: string // medlem i to organisasjoner
let multiOrg: string
let biz: string
let bizOrg: string
let outsider: string

const orgOf = async (uid: string) =>
  (await t.su<{ organization_id: string }>(`select organization_id from public.organization_members where user_id = $1 and role = 'owner'`, [uid]))[0].organization_id
const recipe = (name: string, id?: string) => ({ ...(id ? { id } : {}), name, yield_count: 1 })
const ingredient = (name: string, id?: string) => ({ ...(id ? { id } : {}), name, package_size: 1, unit: 'kg', price: 10 })
const downgrade = (org: string) =>
  t.su(`update public.subscriptions set trial_started_at = now() - interval '40 days', trial_ends_at = now() - interval '10 days' where organization_id = $1`, [org])

beforeAll(async () => {
  t = await createTestDb()
  free = await t.signUp('free@example.com', { full_name: 'Free', terms_version: '2026-11-26-utkast', privacy_version: '2026-11-26-utkast' })
  multi = await t.signUp('multi@example.com', { full_name: 'Multi' })
  biz = await t.signUp('biz@example.com', { full_name: 'Biz', account_type: 'business', organization_name: 'Biz AS' })
  outsider = await t.signUp('outsider@example.com', { full_name: 'Utenforstående' })
  freeOrg = await orgOf(free)
  multiOrg = await orgOf(multi)
  bizOrg = await orgOf(biz)
  await t.as(biz, `select public.add_member_by_email($1, 'multi@example.com', 'admin')`, [bizOrg])
}, 60_000)

describe('redigering ved nådd abonnementsgrense og nedgradering', () => {
  let recipeIds: string[] = []
  let ingredientIds: string[] = []

  beforeAll(async () => {
    for (let i = 0; i < 6; i++) recipeIds.push((await t.as<{ id: string }>(free, 'select public.save_recipe($1, $2, $3) as id', [freeOrg, recipe(`Pro-oppskrift ${i}`), []]))[0].id)
    for (let i = 0; i < 51; i++) ingredientIds.push((await t.as<{ id: string }>(free, 'select public.save_ingredient($1, $2) as id', [freeOrg, ingredient(`Ingrediens ${i}`)]))[0].id)
    await downgrade(freeOrg) // Pro-prøve utløpt → Free (maks 5 oppskrifter / 50 ingredienser)
    recipeIds = recipeIds.slice()
    ingredientIds = ingredientIds.slice()
  })

  it('nedgradering sletter ingen data', async () => {
    expect((await t.as<{ p: string }>(free, 'select public.effective_plan($1) as p', [freeOrg]))[0].p).toBe('free')
    expect((await t.as(free, 'select id from public.recipes')).length).toBe(6)
    expect((await t.as(free, 'select id from public.ingredients')).length).toBe(51)
  })

  it('eksisterende oppskrift kan redigeres via save_recipe over grensen', async () => {
    await t.as(free, 'select public.save_recipe($1, $2, $3)', [freeOrg, { ...recipe('Endret navn', recipeIds[0]), yield_count: 4 }, [{ ingredient_id: ingredientIds[0], amount: 500, unit: 'g' }]])
    const r = (await t.su<{ name: string; yield_count: number }>('select name, yield_count from public.recipes where id = $1', [recipeIds[0]]))[0]
    expect(r).toEqual({ name: 'Endret navn', yield_count: 4 })
  })

  it('eksisterende ingrediens kan redigeres via save_ingredient over grensen', async () => {
    await t.as(free, 'select public.save_ingredient($1, $2)', [freeOrg, { ...ingredient('Nytt navn', ingredientIds[0]), price: 99 }])
    expect(Number((await t.su<{ price: string }>('select price from public.ingredients where id = $1', [ingredientIds[0]]))[0].price)).toBe(99)
  })

  it('direkte REST-redigering (UPDATE) og upsert av eksisterende rad blokkeres ikke av grensen', async () => {
    await t.as(free, `update public.recipes set notes = 'via REST' where id = $1`, [recipeIds[1]])
    await t.as(free, `insert into public.ingredients (id, organization_id, name, package_size, unit, price) values ($1, $2, 'Upsert', 1, 'kg', 5)
      on conflict (id) do update set name = excluded.name, price = excluded.price`, [ingredientIds[1], freeOrg])
    expect((await t.su<{ name: string }>('select name from public.ingredients where id = $1', [ingredientIds[1]]))[0].name).toBe('Upsert')
  })

  it('nye registreringer blokkeres – via RPC, REST-insert og REST-upsert med ny id', async () => {
    await expect(t.as(free, 'select public.save_recipe($1, $2, $3)', [freeOrg, recipe('Ny'), []])).rejects.toThrow(/PLAN_LIMIT/)
    await expect(t.as(free, `insert into public.recipes (organization_id, name, yield_count) values ($1, 'REST', 1)`, [freeOrg])).rejects.toThrow(/PLAN_LIMIT/)
    await expect(t.as(free, `insert into public.ingredients (id, organization_id, name, package_size, unit, price) values (gen_random_uuid(), $1, 'Ny', 1, 'kg', 1)
      on conflict (id) do update set name = excluded.name`, [freeOrg])).rejects.toThrow(/PLAN_LIMIT/)
    await expect(t.as(free, 'select public.save_ingredient($1, $2)', [freeOrg, ingredient('Ny')])).rejects.toThrow(/PLAN_LIMIT/)
  })

  it('sletting frigjør plass igjen', async () => {
    await t.as(free, 'delete from public.recipes where id = any($1)', [recipeIds.slice(4)])
    await t.as(free, 'select public.save_recipe($1, $2, $3)', [freeOrg, recipe('Etter sletting'), []])
  })
})

describe('idempotent import', () => {
  const payload = {
    ingredients: [{ local_id: 'ing-a', name: 'A', package_size: 1, unit: 'kg', price: 1 }, { local_id: 'ing-b', name: 'B', package_size: 1, unit: 'kg', price: 1 }],
    recipes: [{ local_id: 'rec-a', name: 'R', yield_count: 1, ingredients: [{ ingredient_local_id: 'ing-a', amount: 1, unit: 'kg' }] }],
  }

  it('gjentatt import ved nådd grense hopper over eksisterende data i stedet for å feile', async () => {
    const org = await orgOf(outsider)
    const first = (await t.as<{ r: Record<string, number> }>(outsider, 'select public.import_local_data($1, $2) as r', [org, payload]))[0].r
    expect(first).toMatchObject({ ingredients_inserted: 2, recipes_inserted: 1 })
    // Fyll opp til grensen og nedgrader
    for (let i = 0; i < 4; i++) await t.as(outsider, 'select public.save_recipe($1, $2, $3)', [org, recipe(`Fyll ${i}`), []])
    await downgrade(org)
    const again = (await t.as<{ r: Record<string, number> }>(outsider, 'select public.import_local_data($1, $2) as r', [org, payload]))[0].r
    expect(again).toEqual({ ingredients_inserted: 0, ingredients_skipped: 2, recipes_inserted: 0, recipes_skipped: 1 })
    // Nye data i samme import blokkeres fortsatt (atomisk: ingenting lagres)
    const withNew = { ...payload, recipes: [...payload.recipes, { local_id: 'rec-ny', name: 'Ny', yield_count: 1 }] }
    await expect(t.as(outsider, 'select public.import_local_data($1, $2)', [org, withNew])).rejects.toThrow(/PLAN_LIMIT/)
    expect((await t.su(`select 1 from public.recipes where organization_id = $1 and local_id = 'rec-ny'`, [org])).length).toBe(0)
  })

  it('krever gyldig, ikke-tom local_id', async () => {
    for (const bad of ['', '   ', null]) {
      await expect(t.as(multi, 'select public.import_local_data($1, $2)', [multiOrg, { ingredients: [{ local_id: bad, name: 'X', package_size: 1, unit: 'kg', price: 1 }] }])).rejects.toThrow(/lokal id/)
      await expect(t.as(multi, 'select public.import_local_data($1, $2)', [multiOrg, { recipes: [{ local_id: bad, name: 'X', yield_count: 1 }] }])).rejects.toThrow(/lokal id/)
    }
    await expect(t.as(multi, 'select public.import_local_data($1, $2)', [multiOrg, { ingredients: [{ local_id: 'x'.repeat(101), name: 'X', package_size: 1, unit: 'kg', price: 1 }] }])).rejects.toThrow(/lokal id/)
  })
})

describe('organisasjonstilhørighet og identitetsfelt', () => {
  let ingId: string
  let recId: string
  beforeAll(async () => {
    ingId = (await t.as<{ id: string }>(multi, 'select public.save_ingredient($1, $2) as id', [bizOrg, ingredient('Bedriftsmel')]))[0].id
    recId = (await t.as<{ id: string }>(multi, 'select public.save_recipe($1, $2, $3) as id', [bizOrg, recipe('Bedriftsbrød'), [{ ingredient_id: ingId, amount: 1, unit: 'kg' }]]))[0].id
    await t.as(multi, `insert into public.equipment (organization_id, name, watt) values ($1, 'Hevebox', 100)`, [bizOrg])
  })

  it('medlem i to organisasjoner kan ikke flytte data mellom dem (kolonnerettigheter)', async () => {
    for (const table of ['ingredients', 'recipes', 'equipment']) {
      await expect(t.as(multi, `update public.${table} set organization_id = $1 where organization_id = $2`, [multiOrg, bizOrg]), table).rejects.toThrow(/permission denied/)
    }
    await expect(t.as(multi, `update public.recipe_ingredients set organization_id = $1`, [multiOrg])).rejects.toThrow(/permission denied/)
    await expect(t.as(multi, `update public.recipe_ingredients set recipe_id = gen_random_uuid()`)).rejects.toThrow(/permission denied/)
    await expect(t.as(multi, `update public.baking_history set organization_id = $1`, [multiOrg])).rejects.toThrow(/permission denied/)
  })

  it('id, created_by, created_at og local_id kan ikke endres av klienten', async () => {
    await expect(t.as(multi, `update public.ingredients set id = gen_random_uuid() where id = $1`, [ingId])).rejects.toThrow(/permission denied/)
    await expect(t.as(multi, `update public.ingredients set created_by = $1 where id = $2`, [biz, ingId])).rejects.toThrow(/permission denied/)
    await expect(t.as(multi, `update public.recipes set created_at = '2000-01-01' where id = $1`, [recId])).rejects.toThrow(/permission denied/)
    await expect(t.as(multi, `update public.recipes set local_id = 'x' where id = $1`, [recId])).rejects.toThrow(/permission denied/)
  })

  it('trigger stopper flytting også fra serveren/SECURITY DEFINER', async () => {
    await expect(t.su('update public.ingredients set organization_id = $1 where id = $2', [multiOrg, ingId])).rejects.toThrow(/IMMUTABLE/)
    await expect(t.su('update public.recipes set created_by = $1 where id = $2', [outsider, recId])).rejects.toThrow(/IMMUTABLE/)
    await expect(t.su(`update public.recipe_ingredients set recipe_id = $1 where recipe_id = $2`, [recId, recId])).resolves.toBeDefined() // uendret er ok
    await expect(t.su(`update public.organization_members set user_id = $1 where organization_id = $2 and user_id = $3`, [outsider, bizOrg, multi])).rejects.toThrow(/IMMUTABLE/)
  })

  it('created_by og created_at kan ikke forfalskes ved opprettelse', async () => {
    const row = (await t.as<{ created_by: string; created_at: string }>(multi,
      `insert into public.ingredients (organization_id, name, package_size, unit, price, created_by, created_at)
       values ($1, 'Forfalsket', 1, 'kg', 1, $2, '2001-01-01') returning created_by, created_at`, [bizOrg, biz]))[0]
    expect(row.created_by).toBe(multi)
    expect(new Date(row.created_at).getFullYear()).toBeGreaterThan(2020)
    // Historikk: policyen krever created_by = auth.uid(); triggeren setter den uansett
    const h = (await t.as<{ created_by: string }>(multi, `insert into public.baking_history (organization_id, recipe_name, count, kwh, price_per_kwh, electricity_cost, ingredient_cost, total_cost, cost_per_item, created_by)
      values ($1, 'X', 1, 1, 1, 1, 1, 2, 2, $2) returning created_by`, [bizOrg, biz]))[0]
    expect(h.created_by).toBe(multi)
  })

  it('updated_by i electricity_settings settes av serveren og kan ikke forfalskes', async () => {
    await expect(t.as(multi, `update public.electricity_settings set updated_by = $1 where organization_id = $2`, [biz, bizOrg])).rejects.toThrow(/permission denied/)
    await t.as(multi, `update public.electricity_settings set settings = settings || '{"area":"NO2"}' where organization_id = $1`, [bizOrg])
    expect((await t.su<{ updated_by: string }>('select updated_by from public.electricity_settings where organization_id = $1', [bizOrg]))[0].updated_by).toBe(multi)
  })

  it('kaskader fungerer fortsatt (sletting av ingrediens nuller oppskriftslinjen)', async () => {
    await t.as(multi, 'delete from public.ingredients where id = $1', [ingId])
    const line = await t.su<{ ingredient_id: string | null }>('select ingredient_id from public.recipe_ingredients where recipe_id = $1', [recId])
    expect(line[0].ingredient_id).toBeNull()
  })
})

describe('medlemsadministrasjon', () => {
  it('ikke-medlemmer får FORBIDDEN før oppslag – avslører ikke medlemskap', async () => {
    await expect(t.as(outsider, 'select public.remove_member($1, $2)', [bizOrg, multi])).rejects.toThrow(/FORBIDDEN/)
    await expect(t.as(outsider, 'select public.remove_member($1, gen_random_uuid())', [bizOrg])).rejects.toThrow(/FORBIDDEN/)
    await expect(t.as(outsider, `select public.add_member_by_email($1, 'finnes-ikke@example.com')`, [bizOrg])).rejects.toThrow(/FORBIDDEN/)
    await expect(t.as(outsider, 'select * from public.list_organization_members($1)', [bizOrg])).rejects.toThrow(/FORBIDDEN/)
  })

  it('sikkerhetsnett: fjernes siste eier utenom RPC-ene, forfremmes eldste admin', async () => {
    const owner = await t.signUp('netteier@example.com', { full_name: 'Eier', account_type: 'business', organization_name: 'Nett AS' })
    const adm = await t.signUp('nettadmin@example.com', { full_name: 'Admin' })
    const org = await orgOf(owner)
    await t.as(owner, `select public.add_member_by_email($1, 'nettadmin@example.com', 'admin')`, [org])
    await t.su('delete from auth.users where id = $1', [owner]) // f.eks. sletting i Supabase Dashboard
    const roles = await t.su<{ user_id: string; role: string }>('select user_id, role from public.organization_members where organization_id = $1', [org])
    expect(roles).toEqual([{ user_id: adm, role: 'owner' }])
  })
})

describe('kontosletting og GDPR', () => {
  it('krever nylig innlogging – gammel innlogging eller manglende amr avvises', async () => {
    const old = Math.floor(Date.now() / 1000) - 3600
    await expect(t.asWithClaims(outsider, { amr: [{ method: 'password', timestamp: old }] }, `select public.delete_my_account('SLETT')`)).rejects.toThrow(/REAUTH_REQUIRED/)
    await expect(t.asWithClaims(outsider, { amr: [] }, `select public.delete_my_account('SLETT')`)).rejects.toThrow(/REAUTH_REQUIRED/)
    await expect(t.asWithClaims(outsider, { amr: 'tull' }, `select public.delete_my_account('SLETT')`)).rejects.toThrow(/REAUTH_REQUIRED/)
    await expect(t.asWithClaims(outsider, { amr: [{ method: 'password', timestamp: 'nå' }] }, `select public.delete_my_account('SLETT')`)).rejects.toThrow(/REAUTH_REQUIRED/)
    // SLETT kreves fortsatt i tillegg
    await expect(t.as(outsider, `select public.delete_my_account('slett')`)).rejects.toThrow(/CONFIRMATION_REQUIRED/)
    expect((await t.su('select 1 from auth.users where id = $1', [outsider])).length).toBe(1)
  })

  it('godkjenning av vilkår og personvern registreres separat med versjon og servertid', async () => {
    const rows = await t.as<{ document: string; version: string; accepted_at: string }>(free, 'select document, version, accepted_at from public.legal_acceptances order by document')
    expect(rows.map((r) => [r.document, r.version])).toEqual([['privacy', '2026-11-26-utkast'], ['terms', '2026-11-26-utkast']])
    expect(Math.abs(Date.parse(rows[0].accepted_at) - Date.now())).toBeLessThan(120_000)
    // Bruker uten godkjenning i metadata har ingen registrering
    expect((await t.as(multi, 'select 1 from public.legal_acceptances')).length).toBe(0)
  })

  it('klienten kan ikke endre, slette eller skrive godkjenninger direkte', async () => {
    await expect(t.as(free, `update public.legal_acceptances set accepted_at = '2000-01-01'`)).rejects.toThrow(/permission denied/)
    await expect(t.as(free, `delete from public.legal_acceptances`)).rejects.toThrow(/permission denied/)
    await expect(t.as(free, `insert into public.legal_acceptances (user_id, document, version, accepted_at) values ($1, 'terms', '2026-11-26-utkast', '2000-01-01')`, [free])).rejects.toThrow(/permission denied/)
  })

  it('godkjenning via RPC bruker servertid og kun gjeldende versjon', async () => {
    await expect(t.as(multi, `select public.accept_legal_document('terms', '1999-gammel')`)).rejects.toThrow(/INVALID/)
    await t.as(multi, `select public.accept_legal_document('terms', '2026-11-26-utkast')`)
    expect((await t.as(multi, `select 1 from public.legal_acceptances where document = 'terms'`)).length).toBe(1)
  })

  it('eksisterende token gir ingen tilgang etter sletting', async () => {
    const gone = await t.signUp('borte@example.com', { full_name: 'Borte' })
    const org = await orgOf(gone)
    await t.as(gone, 'select public.save_recipe($1, $2, $3)', [org, recipe('Hemmelig'), []])
    await t.as(gone, `select public.delete_my_account('SLETT')`)
    // Samme JWT (sub) etter sletting:
    expect(await t.as(gone, 'select * from public.recipes')).toEqual([])
    expect(await t.as(gone, 'select * from public.profiles')).toEqual([])
    await expect(t.as(gone, 'select public.get_my_context()')).resolves.toBeDefined()
    expect((await t.as<{ c: { organizations: unknown[] } }>(gone, 'select public.get_my_context() as c'))[0].c.organizations).toEqual([])
    await expect(t.as(gone, `insert into public.user_settings (user_id) values ($1)`, [gone])).rejects.toThrow()
    await expect(t.as(gone, `insert into public.recipes (organization_id, name, yield_count) values ($1, 'x', 1)`, [org])).rejects.toThrow()
  })

  it('bevarte bedriftsdata inneholder ingen personopplysninger om slettet bruker', async () => {
    const own = await t.signUp('gdpr-eier@example.com', { full_name: 'GDPR Eier', account_type: 'business', organization_name: 'GDPR AS' })
    const emp = await t.signUp('gdpr-ansatt@example.com', { full_name: 'Ola Ansatt' })
    const org = await orgOf(own)
    await t.as(own, `select public.add_member_by_email($1, 'gdpr-ansatt@example.com')`, [org])
    await t.as(emp, `insert into public.baking_history (organization_id, recipe_name, count, kwh, price_per_kwh, electricity_cost, ingredient_cost, total_cost, cost_per_item, snapshot)
      values ($1, 'Brød', 1, 1, 1, 1, 1, 2, 2, '{"ingredients":[{"name":"Mel","cost":1}]}')`, [org])
    await t.as(emp, 'select public.save_ingredient($1, $2)', [org, ingredient('Ansattes mel')])
    await t.as(emp, `select public.delete_my_account('SLETT')`)
    const dump = JSON.stringify(await t.su('select to_jsonb(h) as h from public.baking_history h where organization_id = $1 union all select to_jsonb(i) from public.ingredients i where organization_id = $1', [org]))
    expect(dump).not.toContain(emp)
    expect(dump).not.toContain('gdpr-ansatt@example.com')
    expect(dump).not.toContain('Ola Ansatt')
  })
})

describe('databaseprivilegier', () => {
  it('PUBLIC og anon har ikke EXECUTE på Bakekalkulatorens funksjoner (unntatt offentlige satser)', async () => {
    const rows = await t.su<{ proname: string; grantee: string }>(`
      select p.proname, coalesce(r.rolname, 'PUBLIC') as grantee
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      left join pg_roles r on r.oid = a.grantee
      where a.privilege_type = 'EXECUTE' and (a.grantee = 0 or r.rolname = 'anon')`)
    const allowed = new Set(['resolve_electricity_tariff', 'active_electricity_tariffs'])
    const offenders = rows.filter((r) => !(r.grantee === 'anon' && allowed.has(r.proname)))
    expect(offenders).toEqual([])
  })

  it('PUBLIC har ingen tabellrettigheter', async () => {
    const rows = await t.su(`select table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee = 'PUBLIC'`)
    expect(rows).toEqual([])
  })

  it('interne funksjoner kan ikke kalles av klienten', async () => {
    for (const fn of ['public.lock_organization(gen_random_uuid())', 'public.effective_plan_internal(gen_random_uuid())', `public.recently_authenticated('1 hour')`, 'public.expire_trials()']) {
      await expect(t.as(multi, `select ${fn}`), fn).rejects.toThrow(/permission denied/)
    }
  })

  it('nye funksjoner og tabeller blir ikke automatisk tilgjengelige for anon/authenticated', async () => {
    await t.su(`create function public.ny_fremtidig_funksjon() returns int language sql as 'select 1'`)
    await t.su(`create table public.ny_fremtidig_tabell (id int)`)
    await expect(t.as(multi, 'select public.ny_fremtidig_funksjon()')).rejects.toThrow(/permission denied/)
    await expect(t.asAnon('select public.ny_fremtidig_funksjon()')).rejects.toThrow(/permission denied/)
    await expect(t.as(multi, 'select * from public.ny_fremtidig_tabell')).rejects.toThrow(/permission denied/)
    await t.su('drop function public.ny_fremtidig_funksjon()')
    await t.su('drop table public.ny_fremtidig_tabell')
  })

  it('anon kan ikke kalle klient-RPC-er', async () => {
    for (const fn of ['public.get_my_context()', 'public.export_my_data()', `public.delete_my_account('SLETT')`, 'public.import_local_data(gen_random_uuid(), \'{}\')']) {
      await expect(t.asAnon(`select ${fn}`), fn).rejects.toThrow(/permission denied/)
    }
  })
})

describe('referansedata', () => {
  it('kun verifiserte, gyldige satser brukes; foreslåtte 2027-satser er ikke registrert', async () => {
    const all = await t.su<{ code: string; valid_from: string; verified_at: string | null; source_url: string }>(`select code, valid_from::text, verified_at::text, source_url from public.electricity_tariffs`)
    expect(all.every((r) => r.verified_at === '2026-11-26')).toBe(true)
    expect(all.some((r) => r.valid_from >= '2027-01-01')).toBe(false)
    expect(all.filter((r) => r.code !== 'elavgift').every((r) => r.source_url.startsWith('https://lovdata.no/'))).toBe(true)
  })

  it('ikke-verifisert sats brukes ikke automatisk', async () => {
    const adm = await t.signUp('ref-admin@example.com', { full_name: 'Admin' })
    await t.su('insert into public.system_admins (user_id) values ($1)', [adm])
    await t.as(adm, 'select public.admin_upsert_tariff($1)', [{ code: 'uverifisert', description: 'X', value: 1, unit: 'kr', valid_from: '2026-01-01', valid_to: '', source_url: 'https://example.com', verified_at: '' }])
    expect(await t.asAnon(`select * from public.resolve_electricity_tariff('uverifisert', '2026-11-26')`)).toEqual([])
    expect((await t.asAnon<{ code: string }>(`select code from public.active_electricity_tariffs('2026-11-26')`)).map((r) => r.code)).not.toContain('uverifisert')
  })

  it('utløpte satser brukes ikke', async () => {
    expect(await t.asAnon(`select * from public.resolve_electricity_tariff('norgespris', '2027-01-01', 'NO1', 'privat')`)).toEqual([])
    expect(await t.asAnon(`select * from public.resolve_electricity_tariff('elavgift', '2027-01-01')`)).toEqual([])
  })
})
