// Databasetester for fase 4: Business-planer, leverandører, prishistorikk,
// lager og matsvinn. Kjører de ekte migrasjonene i PGlite.
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './pgHarness'

let t: TestDb
let admin: string
let owner: string
let staff: string
let other: string
let bizOrg: string
let otherOrg: string
let flour: string

const orgOf = async (uid: string) =>
  (await t.su<{ organization_id: string }>('select organization_id from public.organization_members where user_id = $1 and role = $2', [uid, 'owner']))[0].organization_id
const setPlan = (org: string, plan: string) => t.as(admin, `select public.admin_set_subscription($1, $2::public.subscription_plan, 'active', null)`, [org, plan])
const ingredient = (p: Record<string, unknown> = {}) => ({
  name: 'Hvetemel', category: 'Mel', package_size: 25, unit: 'kg', price: 450, store: '', price_updated: '2026-11-01', ...p,
})
const saveIng = async (uid: string, org: string, p: Record<string, unknown>) =>
  (await t.as<{ id: string }>(uid, 'select public.save_ingredient($1, $2) as id', [org, ingredient(p)]))[0].id
const level = async (org: string, ing: string) =>
  Number((await t.su<{ quantity: string }>('select quantity from public.stock_levels where organization_id = $1 and ingredient_id = $2', [org, ing]))[0]?.quantity ?? 0)

beforeAll(async () => {
  t = await createTestDb()
  admin = await t.signUp('admin@rettilomma.no', { full_name: 'Admin', account_type: 'private' })
  await t.su('insert into public.system_admins (user_id) values ($1)', [admin])
  owner = await t.signUp('eier@restaurant.no', { full_name: 'Eier', account_type: 'business', organization_name: 'Restauranten AS', business_type: 'restaurant' })
  staff = await t.signUp('ansatt@restaurant.no', { full_name: 'Ansatt', account_type: 'private' })
  other = await t.signUp('annen@kafe.no', { full_name: 'Annen', account_type: 'business', organization_name: 'Kafeen', business_type: 'kafe' })
  bizOrg = await orgOf(owner)
  otherOrg = await orgOf(other)
  await t.as(owner, `select public.add_member_by_email($1, 'ansatt@restaurant.no', 'member')`, [bizOrg])
  flour = await saveIng(owner, bizOrg, {})
}, 60_000)

describe('Business-planer', () => {
  it('Business og Business Plus har riktige grenser og funksjoner', async () => {
    const rows = await t.su<{ plan: string; max_members: number; max_recipes: number | null; ai_scans_per_month: number; inventory: boolean; advanced_dashboard: boolean }>(
      `select plan, max_members, max_recipes, ai_scans_per_month, inventory, advanced_dashboard from public.plan_features where plan in ('business', 'business_plus') order by plan`)
    expect(rows).toEqual([
      { plan: 'business', max_members: 50, max_recipes: null, ai_scans_per_month: 500, inventory: true, advanced_dashboard: false },
      { plan: 'business_plus', max_members: 200, max_recipes: null, ai_scans_per_month: 1000, inventory: true, advanced_dashboard: true },
    ])
  })

  it('eksisterende planer får ikke de nye funksjonene, og abonnementer er uendret', async () => {
    const pro = (await t.su<{ inventory: boolean; max_members: number }>(`select inventory, max_members from public.plan_features where plan = 'pro'`))[0]
    expect(pro).toEqual({ inventory: false, max_members: 25 })
    const sub = (await t.su<{ plan: string; status: string }>('select plan, status from public.subscriptions where organization_id = $1', [bizOrg]))[0]
    expect(sub).toEqual({ plan: 'pro', status: 'trialing' })
  })

  it('prøveperioden (Pro) gir ikke lager; Business gir det', async () => {
    expect((await t.as<{ v: boolean }>(owner, `select public.org_has_feature($1, 'inventory') as v`, [bizOrg]))[0].v).toBe(false)
    await setPlan(bizOrg, 'business')
    expect((await t.as<{ v: boolean }>(owner, `select public.org_has_feature($1, 'inventory') as v`, [bizOrg]))[0].v).toBe(true)
    expect((await t.as<{ v: boolean }>(owner, `select public.org_has_feature($1, 'advanced_dashboard') as v`, [bizOrg]))[0].v).toBe(false)
  })

  it('get_my_context viser Business-funksjonene', async () => {
    const ctx = (await t.as<{ c: { organizations: { id: string; features: { inventory: boolean; max_members: number } }[] } }>(owner, 'select public.get_my_context() as c'))[0].c
    expect(ctx.organizations.find((o) => o.id === bizOrg)?.features).toMatchObject({ inventory: true, max_members: 50 })
  })

  it('bare systemadministrator kan sette Business', async () => {
    await expect(t.as(owner, `select public.admin_set_subscription($1, 'business_plus', 'active', null)`, [bizOrg])).rejects.toThrow()
  })
})

describe('leverandører og prishistorikk', () => {
  let asko: string

  it('medlemmer kan registrere leverandører, andre kunder ser dem ikke', async () => {
    asko = (await t.as<{ id: string }>(staff, `insert into public.suppliers (organization_id, name, customer_number) values ($1, 'ASKO', '12345') returning id`, [bizOrg]))[0].id
    expect(await t.as(other, 'select * from public.suppliers where id = $1', [asko])).toHaveLength(0)
    expect(await t.as(other, `update public.suppliers set name = 'X' where id = $1 returning id`, [asko])).toHaveLength(0)
  })

  it('ingrediens får leverandør, varenummer, mva, svinn og minimumsbeholdning', async () => {
    await t.as(owner, 'select public.save_ingredient($1, $2)', [bizOrg, ingredient({ id: flour, supplier_id: asko, supplier_item_no: 'A-77', vat_percent: 15, waste_percent: 2, min_stock: 10, ean: '7038010000737', manufacturer: 'Møllerens' })])
    const r = (await t.su<Record<string, unknown>>('select supplier_id, supplier_item_no, waste_percent, min_stock, ean, manufacturer from public.ingredients where id = $1', [flour]))[0]
    expect(r).toMatchObject({ supplier_id: asko, supplier_item_no: 'A-77', ean: '7038010000737', manufacturer: 'Møllerens' })
    expect(Number(r.waste_percent)).toBe(2)
    expect(Number(r.min_stock)).toBe(10)
  })

  it('eldre klienter som ikke sender feltene, beholder dem', async () => {
    await t.as(owner, 'select public.save_ingredient($1, $2)', [bizOrg, ingredient({ id: flour, price: 450 })])
    const r = (await t.su<{ supplier_id: string; ean: string }>('select supplier_id, ean from public.ingredients where id = $1', [flour]))[0]
    expect(r).toEqual({ supplier_id: asko, ean: '7038010000737' })
  })

  it('ugyldig strekkode og svinn avvises', async () => {
    await expect(t.as(owner, 'select public.save_ingredient($1, $2)', [bizOrg, ingredient({ id: flour, ean: '123' })])).rejects.toThrow()
    await expect(t.as(owner, 'select public.save_ingredient($1, $2)', [bizOrg, ingredient({ id: flour, waste_percent: 99 })])).rejects.toThrow()
  })

  it('prishistorikken skrives automatisk ved prisendring, ikke ellers', async () => {
    const count = async () => (await t.su<{ n: number }>(`select count(*)::int as n from public.ingredient_prices where ingredient_id = $1 and source = 'historikk'`, [flour]))[0].n
    const before = await count()
    await t.as(owner, 'select public.save_ingredient($1, $2)', [bizOrg, ingredient({ id: flour, price: 450, comment: 'bare kommentar' })])
    expect(await count()).toBe(before)
    await t.as(owner, 'select public.save_ingredient($1, $2)', [bizOrg, ingredient({ id: flour, price: 495, price_updated: '2026-11-20' })])
    expect(await count()).toBe(before + 1)
    const last = (await t.su<{ price: string; priced_at: string }>(`select price, priced_at::text from public.ingredient_prices where ingredient_id = $1 order by created_at desc limit 1`, [flour]))[0]
    expect(Number(last.price)).toBe(495)
  })

  it('historikken kan ikke endres eller lages av klienten', async () => {
    await expect(t.as(owner, `insert into public.ingredient_prices (organization_id, ingredient_id, package_size, unit, price, source) values ($1, $2, 1, 'kg', 1, 'historikk')`, [bizOrg, flour])).rejects.toThrow()
    expect(await t.as(owner, `delete from public.ingredient_prices where ingredient_id = $1 and source = 'historikk' returning id`, [flour])).toHaveLength(0)
    await expect(t.as(owner, `update public.ingredient_prices set price = 0 where ingredient_id = $1`, [flour])).rejects.toThrow()
  })

  it('tilbud fra andre leverandører krever Business', async () => {
    const offer = `insert into public.ingredient_prices (organization_id, ingredient_id, package_size, unit, price, source) values ($1, $2, 25, 'kg', 420, 'tilbud') returning id`
    const ok = await t.as<{ id: string }>(staff, offer, [bizOrg, flour])
    expect(ok).toHaveLength(1)
    await setPlan(bizOrg, 'pro')
    await expect(t.as(staff, offer, [bizOrg, flour])).rejects.toThrow()
    await setPlan(bizOrg, 'business')
  })

  it('import av lokale data skriver også historikk', async () => {
    await t.as(other, 'select public.import_local_data($1, $2)', [otherOrg, { ingredients: [{ local_id: 'i1', name: 'Smør', package_size: 0.5, unit: 'kg', price: 60 }], recipes: [] }])
    const n = (await t.su<{ n: number }>(`select count(*)::int as n from public.ingredient_prices where organization_id = $1`, [otherOrg]))[0].n
    expect(n).toBe(1)
  })
})

describe('lager', () => {
  it('innkjøp og uttak gir beholdning; varetelling setter den', async () => {
    await t.as(staff, `insert into public.stock_movements (organization_id, ingredient_id, quantity, kind, unit_cost) values ($1, $2, 50, 'innkjop', 18), ($1, $2, -12.5, 'forbruk', 18)`, [bizOrg, flour])
    expect(await level(bizOrg, flour)).toBe(37.5)
    const delta = (await t.as<{ d: string }>(staff, 'select public.stock_count($1, $2, 30, 18, $3) as d', [bizOrg, flour, 'Telling']))[0].d
    expect(Number(delta)).toBe(-7.5)
    expect(await level(bizOrg, flour)).toBe(30)
    // Lik telling gir ingen ny bevegelse
    expect(Number((await t.as<{ d: string }>(staff, 'select public.stock_count($1, $2, 30, 18, null) as d', [bizOrg, flour]))[0].d)).toBe(0)
  })

  it('krever Business, og andre kunder ser ingenting', async () => {
    const other_ing = await saveIng(other, otherOrg, { name: 'Smør' })
    await expect(t.as(other, `insert into public.stock_movements (organization_id, ingredient_id, quantity, kind) values ($1, $2, 1, 'innkjop')`, [otherOrg, other_ing])).rejects.toThrow()
    await expect(t.as(other, 'select public.stock_count($1, $2, 5)', [otherOrg, other_ing])).rejects.toThrow(/Business/)
    expect(await t.as(other, 'select * from public.stock_levels where ingredient_id = $1', [flour])).toHaveLength(0)
    expect(await t.as(other, 'select * from public.stock_movements where organization_id = $1', [bizOrg])).toHaveLength(0)
  })

  it('kan ikke registrere på andre kunders ingredienser', async () => {
    await setPlan(otherOrg, 'business')
    await expect(t.as(other, `insert into public.stock_movements (organization_id, ingredient_id, quantity, kind) values ($1, $2, 1, 'innkjop')`, [otherOrg, flour])).rejects.toThrow()
    await setPlan(otherOrg, 'pro')
  })

  it('bare eier/administrator kan slette bevegelser', async () => {
    expect(await t.as(staff, 'delete from public.stock_movements where organization_id = $1 returning id', [bizOrg])).toHaveLength(0)
    await expect(t.as(staff, `update public.stock_movements set quantity = 1 where organization_id = $1`, [bizOrg])).rejects.toThrow()
  })

  it('negativ telling og null-bevegelse avvises', async () => {
    await expect(t.as(staff, 'select public.stock_count($1, $2, -1)', [bizOrg, flour])).rejects.toThrow()
    await expect(t.as(staff, `insert into public.stock_movements (organization_id, ingredient_id, quantity, kind) values ($1, $2, 0, 'innkjop')`, [bizOrg, flour])).rejects.toThrow()
  })
})

describe('matsvinn', () => {
  const entry = (p: Record<string, unknown> = {}) => ({ name: 'Hvetemel', amount: 2, unit: 'kg', cost: 39.6, reason: 'odelagt', logged_at: '2026-11-28', ...p })

  it('registreres med kostnad, og kan trekke fra lageret i samme transaksjon', async () => {
    const before = await level(bizOrg, flour)
    await t.as(staff, 'select public.register_waste($1, $2, true)', [bizOrg, entry({ ingredient_id: flour, stock_quantity: 2, unit_cost: 19.8 })])
    expect(await level(bizOrg, flour)).toBe(before - 2)
    const w = (await t.su<{ cost: string; reason: string; created_by: string }>('select cost, reason, created_by from public.waste_logs where organization_id = $1', [bizOrg]))[0]
    expect(w).toMatchObject({ reason: 'odelagt', created_by: staff })
    expect(Number(w.cost)).toBe(39.6)
  })

  it('kostnaden endres ikke når prisen endres senere', async () => {
    await t.as(owner, 'select public.save_ingredient($1, $2)', [bizOrg, ingredient({ id: flour, price: 900 })])
    expect(Number((await t.su<{ cost: string }>('select cost from public.waste_logs where organization_id = $1', [bizOrg]))[0].cost)).toBe(39.6)
  })

  it('ugyldig årsak avvises, og ingenting lagres (heller ikke lageruttaket)', async () => {
    const before = await level(bizOrg, flour)
    await expect(t.as(staff, 'select public.register_waste($1, $2, true)', [bizOrg, entry({ ingredient_id: flour, stock_quantity: 1, reason: 'kjedelig' })])).rejects.toThrow()
    expect(await level(bizOrg, flour)).toBe(before)
  })

  it('krever Business og medlemskap, og kan ikke settes inn direkte', async () => {
    await expect(t.as(other, 'select public.register_waste($1, $2, false)', [otherOrg, entry()])).rejects.toThrow(/Business/)
    await expect(t.as(other, 'select public.register_waste($1, $2, false)', [bizOrg, entry()])).rejects.toThrow()
    await expect(t.as(staff, `insert into public.waste_logs (organization_id, name, amount, unit, reason) values ($1, 'x', 1, 'kg', 'annet')`, [bizOrg])).rejects.toThrow()
    expect(await t.as(other, 'select * from public.waste_logs where organization_id = $1', [bizOrg])).toHaveLength(0)
  })

  it('bare eier/administrator kan slette registreringer', async () => {
    expect(await t.as(staff, 'delete from public.waste_logs where organization_id = $1 returning id', [bizOrg])).toHaveLength(0)
    expect(await t.as(owner, 'delete from public.waste_logs where organization_id = $1 returning id', [bizOrg])).toHaveLength(1)
  })

  it('oppskriftens tilberedningssvinn lagres via save_recipe', async () => {
    const id = (await t.as<{ id: string }>(owner, `select public.save_recipe($1, $2, '[]') as id`, [bizOrg, { name: 'Suppe', type: 'annet', yield_count: 10, waste_percent: 8 }]))[0].id
    expect(Number((await t.su<{ w: string }>('select waste_percent as w from public.recipes where id = $1', [id]))[0].w)).toBe(8)
    await t.as(owner, `select public.save_recipe($1, $2, '[]')`, [bizOrg, { id, name: 'Suppe', type: 'annet', yield_count: 10 }])
    expect(Number((await t.su<{ w: string }>('select waste_percent as w from public.recipes where id = $1', [id]))[0].w)).toBe(8)
  })
})

describe('eksport', () => {
  it('leverandører, prishistorikk, lager og svinn er med', async () => {
    const ex = (await t.as<{ e: { organizations: Record<string, unknown[]>[] } }>(owner, 'select public.export_my_data() as e'))[0].e
    const o = ex.organizations[0]
    expect(o.suppliers.length).toBe(1)
    expect(o.ingredient_prices.length).toBeGreaterThan(1)
    expect(o.stock_movements.length).toBeGreaterThan(1)
    expect(o).toHaveProperty('waste_logs')
  })
})
