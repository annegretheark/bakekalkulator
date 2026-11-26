// Databasetester: registrering, profiler, organisasjoner/roller, RLS og kundeisolasjon,
// prøveperioder, import, historikk, strømprissatser, administrasjon og personvern.
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './pgHarness'

let t: TestDb
let alice: string // privatperson
let bob: string // bedriftseier
let carol: string // ansatt hos bob
let mallory: string // annen kunde
let aliceOrg: string
let bobOrg: string
let malloryOrg: string

const orgOf = async (uid: string) =>
  (await t.su<{ organization_id: string }>('select organization_id from public.organization_members where user_id = $1 and role = $2', [uid, 'owner']))[0].organization_id

async function addIngredient(uid: string, org: string, name = 'Mel', localId: string | null = null) {
  const rows = await t.as<{ id: string }>(uid,
    `insert into public.ingredients (organization_id, name, package_size, unit, price, local_id) values ($1, $2, 2, 'kg', 32, $3) returning id`,
    [org, name, localId])
  return rows[0].id
}

beforeAll(async () => {
  t = await createTestDb()
  alice = await t.signUp('alice@example.com', { full_name: 'Alice Hansen', account_type: 'private' })
  bob = await t.signUp('bob@bakeri.no', { full_name: 'Bob Baker', account_type: 'business', organization_name: 'Bobs Bakeri AS' })
  carol = await t.signUp('carol@bakeri.no', { full_name: 'Carol Ansatt', account_type: 'private' })
  mallory = await t.signUp('mallory@example.com', { full_name: 'Mallory', account_type: 'private' })
  aliceOrg = await orgOf(alice)
  bobOrg = await orgOf(bob)
  malloryOrg = await orgOf(mallory)
}, 60_000)

describe('registrering', () => {
  it('oppretter profil, privat organisasjon, eiermedlemskap og 30 dagers Pro-prøve atomisk', async () => {
    const ctx = (await t.as<{ c: { profile: { full_name: string }; organizations: { type: string; role: string; subscription: { plan: string; status: string; effective_plan: string; trial_started_at: string; trial_ends_at: string } }[] } }>(alice, 'select public.get_my_context() as c'))[0].c
    expect(ctx.profile.full_name).toBe('Alice Hansen')
    expect(ctx.organizations).toHaveLength(1)
    const o = ctx.organizations[0]
    expect(o.type).toBe('private')
    expect(o.role).toBe('owner')
    expect(o.subscription).toMatchObject({ plan: 'pro', status: 'trialing', effective_plan: 'pro' })
    const days = (Date.parse(o.subscription.trial_ends_at) - Date.parse(o.subscription.trial_started_at)) / 86_400_000
    expect(days).toBeCloseTo(30, 3)
  })

  it('bedrift får organisasjonsnavn og strømoppsett som bedrift', async () => {
    const org = (await t.as<{ name: string; type: string }>(bob, 'select name, type from public.organizations'))[0]
    expect(org).toEqual({ name: 'Bobs Bakeri AS', type: 'business' })
    const es = (await t.as<{ settings: { customerType: string } }>(bob, 'select settings from public.electricity_settings'))[0]
    expect(es.settings.customerType).toBe('bedrift')
  })

  it('aktiv organisasjon settes i brukerinnstillingene', async () => {
    const s = (await t.as<{ active_organization_id: string }>(alice, 'select active_organization_id from public.user_settings'))[0]
    expect(s.active_organization_id).toBe(aliceOrg)
  })
})

describe('brukerprofiler', () => {
  it('bruker ser bare egen profil', async () => {
    const rows = await t.as<{ id: string }>(alice, 'select id from public.profiles')
    expect(rows.map((r) => r.id)).toEqual([alice])
  })
  it('kan endre eget navn, men ikke e-post', async () => {
    await t.as(alice, `update public.profiles set full_name = 'Alice H.' where id = $1`, [alice])
    expect((await t.su<{ full_name: string }>('select full_name from public.profiles where id = $1', [alice]))[0].full_name).toBe('Alice H.')
    await expect(t.as(alice, `update public.profiles set email = 'x@y.no' where id = $1`, [alice])).rejects.toThrow(/permission denied/)
  })
  it('kan ikke endre andres profil', async () => {
    await t.as(mallory, `update public.profiles set full_name = 'Hacket' where id = $1`, [alice])
    expect((await t.su<{ full_name: string }>('select full_name from public.profiles where id = $1', [alice]))[0].full_name).toBe('Alice H.')
  })
})

describe('RLS og kundeisolasjon', () => {
  let aliceIng: string

  beforeAll(async () => {
    aliceIng = await addIngredient(alice, aliceOrg, 'Alices mel')
    await t.as(alice, `select public.save_recipe($1, $2, $3)`, [aliceOrg, { name: 'Alices brød', yield_count: 3, type: 'brod' }, [{ ingredient_id: aliceIng, amount: 750, unit: 'g' }]])
  })

  it('en annen kunde ser ingen av dataene', async () => {
    for (const table of ['ingredients', 'recipes', 'recipe_ingredients', 'organizations', 'subscriptions', 'organization_members', 'electricity_settings']) {
      const rows = await t.as<{ organization_id?: string; id?: string }>(mallory, `select * from public.${table}`)
      const ids = rows.map((r) => r.organization_id ?? r.id)
      expect(ids, table).not.toContain(aliceOrg)
    }
  })

  it('kan ikke endre eller slette andres data', async () => {
    await t.as(mallory, `update public.ingredients set price = 0 where id = $1`, [aliceIng])
    await t.as(mallory, `delete from public.ingredients where id = $1`, [aliceIng])
    const r = await t.su<{ price: string }>('select price from public.ingredients where id = $1', [aliceIng])
    expect(Number(r[0].price)).toBe(32)
  })

  it('kan ikke skrive inn data i en annen kundes organisasjon', async () => {
    await expect(addIngredient(mallory, aliceOrg)).rejects.toThrow(/row-level security/)
    await expect(t.as(mallory, `select public.save_recipe($1, $2, '[]')`, [aliceOrg, { name: 'X', yield_count: 1 }])).rejects.toThrow(/FORBIDDEN/)
  })

  it('kan ikke koble en annen kundes ingrediens inn i egen oppskrift', async () => {
    await expect(t.as(mallory, `select public.save_recipe($1, $2, $3)`, [malloryOrg, { name: 'Tyveri', yield_count: 1 }, [{ ingredient_id: aliceIng, amount: 1, unit: 'g' }]]))
      .rejects.toThrow(/foreign key/)
  })

  it('kan ikke overta en annen kundes oppskrift via save_recipe med samme id', async () => {
    const recipeId = (await t.su<{ id: string }>('select id from public.recipes where organization_id = $1', [aliceOrg]))[0].id
    await expect(t.as(mallory, `select public.save_recipe($1, $2, '[]')`, [malloryOrg, { id: recipeId, name: 'Overtatt', yield_count: 1 }])).rejects.toThrow()
    expect((await t.su<{ name: string }>('select name from public.recipes where id = $1', [recipeId]))[0].name).toBe('Alices brød')
  })

  it('anonyme brukere har ingen tilgang til kundedata', async () => {
    await expect(t.asAnon('select * from public.ingredients')).rejects.toThrow(/permission denied/)
    await expect(t.asAnon('select * from public.profiles')).rejects.toThrow(/permission denied/)
  })

  it('kan ikke gjøre seg selv til systemadministrator', async () => {
    await expect(t.as(mallory, 'insert into public.system_admins (user_id) values ($1)', [mallory])).rejects.toThrow(/permission denied/)
    expect((await t.as<{ a: boolean }>(mallory, 'select public.is_system_admin() as a'))[0].a).toBe(false)
  })

  it('effective_plan avslører ikke andre kunders plan', async () => {
    await expect(t.as(mallory, 'select public.effective_plan($1)', [aliceOrg])).rejects.toThrow(/FORBIDDEN/)
  })
})

describe('organisasjoner og roller', () => {
  it('eier kan legge til medlem i bedrift', async () => {
    await t.as(bob, `select public.add_member_by_email($1, 'carol@bakeri.no', 'member')`, [bobOrg])
    const members = await t.as<{ role: string; email: string }>(carol, 'select * from public.list_organization_members($1)', [bobOrg])
    expect(members.map((m) => m.role).sort()).toEqual(['member', 'owner'])
  })

  it('medlem ser bedriftens data, men ikke andre organisasjoner', async () => {
    await addIngredient(bob, bobOrg, 'Bakerimel')
    const rows = await t.as<{ name: string }>(carol, 'select name from public.ingredients where organization_id = $1', [bobOrg])
    expect(rows.map((r) => r.name)).toContain('Bakerimel')
  })

  it('kan ikke endre egen rolle eller roller direkte', async () => {
    await expect(t.as(carol, `update public.organization_members set role = 'owner' where user_id = $1`, [carol])).rejects.toThrow(/permission denied/)
    await expect(t.as(carol, `select public.set_member_role($1, $2, 'owner')`, [bobOrg, carol])).rejects.toThrow(/FORBIDDEN/)
    await expect(t.as(bob, `select public.set_member_role($1, $2, 'member')`, [bobOrg, bob])).rejects.toThrow(/egen rolle/)
  })

  it('kan ikke endre abonnement direkte', async () => {
    await expect(t.as(bob, `update public.subscriptions set plan = 'pro', status = 'active'`)).rejects.toThrow(/permission denied/)
    await expect(t.as(bob, `select public.admin_set_subscription($1, 'pro', 'active')`, [bobOrg])).rejects.toThrow(/FORBIDDEN/)
  })

  it('admin kan ikke fjerne eier; eier kan forfremme', async () => {
    await t.as(bob, `select public.set_member_role($1, $2, 'admin')`, [bobOrg, carol])
    await expect(t.as(carol, 'select public.remove_member($1, $2)', [bobOrg, bob])).rejects.toThrow(/FORBIDDEN/)
  })

  it('medlem kan ikke endre strømoppsett, admin kan', async () => {
    const dave = await t.signUp('dave@bakeri.no', { full_name: 'Dave' })
    await t.as(bob, `select public.add_member_by_email($1, 'dave@bakeri.no', 'member')`, [bobOrg])
    await t.as(dave, `update public.electricity_settings set settings = '{"x":1}' where organization_id = $1`, [bobOrg])
    expect((await t.su<{ settings: object }>('select settings from public.electricity_settings where organization_id = $1', [bobOrg]))[0].settings).not.toEqual({ x: 1 })
    await t.as(carol, `update public.electricity_settings set settings = settings || '{"area":"NO5"}' where organization_id = $1`, [bobOrg])
    expect((await t.su<{ settings: { area: string } }>('select settings from public.electricity_settings where organization_id = $1', [bobOrg]))[0].settings.area).toBe('NO5')
  })

  it('privatperson kan ikke legge til medlemmer', async () => {
    await expect(t.as(alice, `select public.add_member_by_email($1, 'mallory@example.com')`, [aliceOrg])).rejects.toThrow(/BUSINESS_ONLY/)
  })

  it('siste eier kan ikke forlate organisasjonen', async () => {
    await expect(t.as(bob, 'select public.leave_organization($1)', [bobOrg])).rejects.toThrow(/LAST_OWNER/)
  })
})

describe('prøveperiode og plan', () => {
  it('etter utløpt prøveperiode gjelder Free, uten at data slettes', async () => {
    for (let i = 0; i < 5; i++) await t.as(mallory, `select public.save_recipe($1, $2, '[]')`, [malloryOrg, { name: `Oppskrift ${i}`, yield_count: 1 }])
    await t.su(`update public.subscriptions set trial_started_at = now() - interval '40 days', trial_ends_at = now() - interval '10 days' where organization_id = $1`, [malloryOrg])

    expect((await t.as<{ p: string }>(mallory, 'select public.effective_plan($1) as p', [malloryOrg]))[0].p).toBe('free')
    expect((await t.as(mallory, 'select id from public.recipes')).length).toBe(5) // data beholdes
    await expect(t.as(mallory, `select public.save_recipe($1, $2, '[]')`, [malloryOrg, { name: 'Nr 6', yield_count: 1 }])).rejects.toThrow(/PLAN_LIMIT/)
  })

  it('Free kan ikke registrere salg (håndheves i databasen)', async () => {
    await expect(t.as(mallory, `insert into public.baking_history (organization_id, recipe_name, count, kwh, price_per_kwh, electricity_cost, ingredient_cost, total_cost, cost_per_item, revenue)
      values ($1, 'Salg', 10, 1, 1, 1, 10, 11, 1.1, 200)`, [malloryOrg])).rejects.toThrow(/PLAN_FEATURE/)
  })

  it('Pro-prøve kan registrere salg', async () => {
    await t.as(alice, `insert into public.baking_history (organization_id, recipe_name, count, kwh, price_per_kwh, electricity_cost, ingredient_cost, total_cost, cost_per_item, revenue, profit)
      values ($1, 'Salg', 10, 1, 1, 1, 10, 11, 1.1, 200, 189)`, [aliceOrg])
  })

  it('expire_trials markerer utløpte prøver som Free (kun server)', async () => {
    await expect(t.as(mallory, 'select public.expire_trials()')).rejects.toThrow(/permission denied/)
    const n = (await t.su<{ n: number }>('select public.expire_trials() as n'))[0].n
    expect(n).toBeGreaterThanOrEqual(1)
    const s = (await t.su<{ plan: string; status: string }>('select plan, status from public.subscriptions where organization_id = $1', [malloryOrg]))[0]
    expect(s).toEqual({ plan: 'free', status: 'expired' })
  })

  it('aktivt betalt abonnement gir planens funksjoner', async () => {
    await t.su(`update public.subscriptions set plan = 'plus', status = 'active', current_period_end = now() + interval '30 days' where organization_id = $1`, [malloryOrg])
    expect((await t.as<{ p: string }>(mallory, 'select public.effective_plan($1) as p', [malloryOrg]))[0].p).toBe('plus')
    await t.as(mallory, `select public.save_recipe($1, $2, '[]')`, [malloryOrg, { name: 'Nr 6', yield_count: 1 }])
  })
})

describe('import av lokale data', () => {
  const payload = {
    ingredients: [
      { local_id: 'ing-hvetemel', name: 'Hvetemel', category: 'Mel', package_size: 2, unit: 'kg', price: 32, store: 'X', price_updated: '2026-11-01' },
      { local_id: 'ing-salt', name: 'Salt', category: 'Krydder', package_size: 1, unit: 'kg', price: 15, store: 'X' },
    ],
    recipes: [{
      local_id: 'rec-grovbrod', name: 'Tre grove brød', type: 'brod', yield_count: 3, steps: ['Bland', 'Stek'], rise_minutes: 90, bake_minutes: 45,
      store_price_per_item: 45, notes: '', energy: { ovenWatt: 2500 },
      ingredients: [{ ingredient_local_id: 'ing-hvetemel', amount: 1250, unit: 'g' }, { ingredient_local_id: 'ing-salt', amount: 30, unit: 'g' }],
    }],
  }

  it('importerer og kobler ingredienser', async () => {
    const r = (await t.as<{ r: Record<string, number> }>(alice, 'select public.import_local_data($1, $2) as r', [aliceOrg, payload]))[0].r
    expect(r).toEqual({ ingredients_inserted: 2, ingredients_skipped: 0, recipes_inserted: 1, recipes_skipped: 0 })
    const lines = await t.as<{ ingredient_id: string | null }>(alice,
      `select ri.ingredient_id from public.recipe_ingredients ri join public.recipes r on r.id = ri.recipe_id where r.local_id = 'rec-grovbrod'`)
    expect(lines).toHaveLength(2)
    expect(lines.every((l) => l.ingredient_id)).toBe(true)
  })

  it('gjentatt import gir ingen duplikater', async () => {
    const r = (await t.as<{ r: Record<string, number> }>(alice, 'select public.import_local_data($1, $2) as r', [aliceOrg, payload]))[0].r
    expect(r).toEqual({ ingredients_inserted: 0, ingredients_skipped: 2, recipes_inserted: 0, recipes_skipped: 1 })
    expect((await t.as(alice, `select id from public.recipes where local_id = 'rec-grovbrod'`)).length).toBe(1)
  })

  it('import er atomisk – ugyldige data lagrer ingenting', async () => {
    const bad = { ingredients: [{ local_id: 'ny-1', name: 'Gyldig', package_size: 1, unit: 'kg', price: 1 }, { local_id: 'ny-2', name: 'Ugyldig', package_size: 1, unit: 'kopp', price: 1 }] }
    await expect(t.as(alice, 'select public.import_local_data($1, $2)', [aliceOrg, bad])).rejects.toThrow()
    expect((await t.as(alice, `select id from public.ingredients where local_id = 'ny-1'`)).length).toBe(0)
  })

  it('kan ikke importere til en annen kundes organisasjon', async () => {
    await expect(t.as(mallory, 'select public.import_local_data($1, $2)', [aliceOrg, payload])).rejects.toThrow(/FORBIDDEN/)
  })
})

describe('historiske kostnader', () => {
  let logId: string
  let recipeId: string
  beforeAll(async () => {
    recipeId = (await t.as<{ id: string }>(alice, `select id from public.recipes where local_id = 'rec-grovbrod'`))[0].id
    logId = (await t.as<{ id: string }>(alice, `insert into public.baking_history (organization_id, recipe_id, recipe_name, type, count, kwh, price_per_kwh, electricity_cost, ingredient_cost, total_cost, cost_per_item, store_price_per_item, snapshot)
      values ($1, $2, 'Tre grove brød', 'brod', 3, 1.9, 1.35, 2.57, 56.2, 58.77, 19.59, 45, '{"ingredients":[{"name":"Hvetemel","cost":20}]}') returning id`, [aliceOrg, recipeId]))[0].id
  })

  it('kan ikke endres etter lagring', async () => {
    await expect(t.as(alice, 'update public.baking_history set total_cost = 1 where id = $1', [logId])).rejects.toThrow(/permission denied/)
    await expect(t.su('update public.baking_history set total_cost = 1 where id = $1', [logId])).rejects.toThrow(/HISTORY_IMMUTABLE/)
  })

  it('påvirkes ikke av nye ingredienspriser eller sletting av oppskriften', async () => {
    await t.as(alice, `update public.ingredients set price = price * 10 where organization_id = $1`, [aliceOrg])
    await t.as(alice, 'delete from public.recipes where id = $1', [recipeId])
    const h = (await t.as<{ recipe_id: string | null; total_cost: string; ingredient_cost: string }>(alice, 'select recipe_id, total_cost, ingredient_cost from public.baking_history where id = $1', [logId]))[0]
    expect(h.recipe_id).toBeNull()
    expect(Number(h.total_cost)).toBe(58.77)
    expect(Number(h.ingredient_cost)).toBe(56.2)
  })

  it('andre kunder ser ikke historikken', async () => {
    expect((await t.as(mallory, 'select id from public.baking_history where id = $1', [logId])).length).toBe(0)
  })
})

describe('strømprissatser', () => {
  it('alle kan lese satser, også uten innlogging', async () => {
    expect((await t.asAnon('select code from public.electricity_tariffs')).length).toBeGreaterThan(0)
  })

  it('utløpte satser returneres ikke som gjeldende', async () => {
    const now = await t.asAnon<{ code: string }>(`select code from public.active_electricity_tariffs('2026-11-26')`)
    expect(now.map((r) => r.code)).toContain('norgespris')
    const later = await t.asAnon<{ code: string }>(`select code from public.active_electricity_tariffs('2027-01-05')`)
    expect(later.map((r) => r.code)).not.toContain('norgespris')
    expect(later.map((r) => r.code)).not.toContain('stromstotte_terskel')
  })

  it('kun systemadministrator kan endre satser', async () => {
    const tariff = { code: 'norgespris', description: 'Norgespris 2027', value: 0.45, unit: 'kr/kWh eks. mva', customer_type: 'privat', valid_from: '2027-01-01', valid_to: '2027-12-31', source_url: 'https://www.regjeringen.no/', verified_at: '2026-11-26' }
    await expect(t.as(alice, 'select public.admin_upsert_tariff($1)', [tariff])).rejects.toThrow(/FORBIDDEN/)
    await expect(t.as(alice, `insert into public.electricity_tariffs (code, description, value, unit, valid_from, source_url, verified_at) values ('x','x',1,'x','2026-01-01','https://x','2026-01-01')`)).rejects.toThrow(/permission denied/)
  })
})

describe('systemadministrasjon', () => {
  let admin: string
  beforeAll(async () => {
    admin = await t.signUp('eier@rettilomma.no', { full_name: 'Systemeier' })
    await t.su('insert into public.system_admins (user_id) values ($1)', [admin])
  })

  it('ser aggregater og abonnementer', async () => {
    const o = (await t.as<{ o: Record<string, number> }>(admin, 'select public.admin_overview() as o'))[0].o
    expect(o.customers).toBeGreaterThanOrEqual(5)
    expect(o.active_trials).toBeGreaterThanOrEqual(1)
    const subs = await t.as(admin, 'select * from public.admin_list_subscriptions()')
    expect(subs.length).toBeGreaterThanOrEqual(5)
  })

  it('kan administrere satser', async () => {
    const id = (await t.as<{ id: string }>(admin, 'select public.admin_upsert_tariff($1) as id', [{ code: 'test_sats', description: 'Test', value: 1, unit: 'kr', valid_from: '2026-01-01', source_url: 'https://example.com', verified_at: '2026-11-26' }]))[0].id
    await t.as(admin, 'select public.admin_delete_tariff($1)', [id])
  })

  it('har ikke tilgang til kundenes oppskrifter eller ingredienser', async () => {
    expect((await t.as(admin, 'select * from public.recipes where organization_id <> (select active_organization_id from public.user_settings)')).length).toBe(0)
    expect((await t.as(admin, 'select * from public.ingredients where organization_id = $1', [aliceOrg])).length).toBe(0)
  })

  it('vanlige brukere får ikke admin-data', async () => {
    await expect(t.as(alice, 'select public.admin_overview()')).rejects.toThrow(/FORBIDDEN/)
    await expect(t.as(alice, 'select * from public.admin_list_subscriptions()')).rejects.toThrow(/FORBIDDEN/)
  })
})

describe('personvern', () => {
  it('eksport inneholder kun egne data', async () => {
    const d = (await t.as<{ d: { organizations: { organization: { id: string } }[] } }>(alice, 'select public.export_my_data() as d'))[0].d
    expect(d.organizations.map((o) => o.organization.id)).toEqual([aliceOrg])
  })

  it('sletting krever bekreftelse', async () => {
    await expect(t.as(alice, `select public.delete_my_account('ja')`)).rejects.toThrow(/CONFIRMATION_REQUIRED/)
  })

  it('eier som slettes i bedrift med flere medlemmer: eierskap overføres og data beholdes', async () => {
    const r = (await t.as<{ r: Record<string, number> }>(bob, `select public.delete_my_account('SLETT') as r`))[0].r
    expect(r.transferred_ownership).toBe(1)
    const roles = await t.su<{ user_id: string; role: string }>('select user_id, role from public.organization_members where organization_id = $1', [bobOrg])
    expect(roles.find((x) => x.user_id === carol)?.role).toBe('owner') // admin prioriteres
    expect((await t.su('select id from public.ingredients where organization_id = $1', [bobOrg])).length).toBeGreaterThan(0)
    expect((await t.su('select id from auth.users where id = $1', [bob])).length).toBe(0)
  })

  it('privatperson som slettes: organisasjon og alle data fjernes', async () => {
    await t.as(alice, `select public.delete_my_account('SLETT')`)
    for (const table of ['organizations', 'ingredients', 'recipes', 'baking_history', 'subscriptions']) {
      const col = table === 'organizations' ? 'id' : 'organization_id'
      expect((await t.su(`select 1 from public.${table} where ${col} = $1`, [aliceOrg])).length, table).toBe(0)
    }
    expect((await t.su('select 1 from public.profiles where id = $1', [alice])).length).toBe(0)
  })
})
