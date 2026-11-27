// Databasetester for fase 2: allergener, underoppskrifter, arbeidstid,
// personal- og driftskostnader og menyer.
// Kjører de ekte migrasjonene i PGlite (ingenting mot den eksterne databasen).
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './pgHarness'

let t: TestDb
let owner: string
let staff: string
let other: string
let bizOrg: string
let otherOrg: string

const orgOf = async (uid: string) =>
  (await t.su<{ organization_id: string }>('select organization_id from public.organization_members where user_id = $1 and role = $2', [uid, 'owner']))[0].organization_id

const ingredient = (p: Record<string, unknown> = {}) => ({
  name: 'Hvetemel', category: 'Mel', package_size: 1, unit: 'kg', price: 20, store: '', price_updated: '2026-11-28',
  allergens: { gluten: 'ja', egg: 'nei' }, allergens_checked: true, ...p,
})
const recipe = (p: Record<string, unknown> = {}) => ({
  name: 'Pizzadeig', type: 'pizza', category: 'pizza', yield_unit: 'stk', yield_count: 4, steps: [], prep_minutes: 10,
  rise_minutes: 60, bake_minutes: 0, finished_weight_g: 1000, store_price_per_item: 0, notes: '', energy: {},
  labor: [{ id: 'l1', roleId: 'kokk', people: 1, minutes: 20 }], packaging_per_unit: 2.5, cross_contact: ['sesam'], ...p,
})
const saveRecipe = async (uid: string, org: string, r: Record<string, unknown>, lines: unknown[] = []) =>
  (await t.as<{ id: string }>(uid, 'select public.save_recipe($1, $2, $3) as id', [org, r, JSON.stringify(lines)]))[0].id

beforeAll(async () => {
  t = await createTestDb()
  owner = await t.signUp('eier@restaurant.no', { full_name: 'Eier', account_type: 'business', organization_name: 'Restauranten AS', business_type: 'restaurant' })
  staff = await t.signUp('ansatt@restaurant.no', { full_name: 'Ansatt', account_type: 'private' })
  other = await t.signUp('annen@kafe.no', { full_name: 'Annen', account_type: 'business', organization_name: 'Kafeen', business_type: 'kafe' })
  bizOrg = await orgOf(owner)
  otherOrg = await orgOf(other)
  await t.as(owner, `select public.add_member_by_email($1, 'ansatt@restaurant.no', 'member')`, [bizOrg])
}, 60_000)

describe('allergener på ingredienser', () => {
  it('lagres via save_ingredient og beholdes når eldre klienter ikke sender dem', async () => {
    const id = (await t.as<{ id: string }>(staff, 'select public.save_ingredient($1, $2) as id', [bizOrg, ingredient()]))[0].id
    let row = (await t.su<{ allergens: Record<string, string>; allergens_checked: boolean }>('select allergens, allergens_checked from public.ingredients where id = $1', [id]))[0]
    expect(row).toEqual({ allergens: { gluten: 'ja', egg: 'nei' }, allergens_checked: true })

    const old = ingredient({ id, price: 25 }) as Record<string, unknown>
    delete old.allergens
    delete old.allergens_checked
    await t.as(staff, 'select public.save_ingredient($1, $2)', [bizOrg, old])
    row = (await t.su<{ allergens: Record<string, string>; allergens_checked: boolean }>('select allergens, allergens_checked from public.ingredients where id = $1', [id]))[0]
    expect(row.allergens).toEqual({ gluten: 'ja', egg: 'nei' })
  })

  it('nye ingredienser uten allergener får tomt kart (ukjent), ikke «inneholder ikke»', async () => {
    const p = ingredient({ name: 'Ost' }) as Record<string, unknown>
    delete p.allergens
    const id = (await t.as<{ id: string }>(owner, 'select public.save_ingredient($1, $2) as id', [bizOrg, p]))[0].id
    const row = (await t.su<{ allergens: Record<string, string> }>('select allergens from public.ingredients where id = $1', [id]))[0]
    expect(row.allergens).toEqual({})
  })

  it('ukjente allergenkoder og verdier avvises', async () => {
    await expect(t.as(owner, 'select public.save_ingredient($1, $2)', [bizOrg, ingredient({ allergens: { kokos: 'ja' } })])).rejects.toThrow()
    await expect(t.as(owner, 'select public.save_ingredient($1, $2)', [bizOrg, ingredient({ allergens: { gluten: 'kanskje' } })])).rejects.toThrow()
    await expect(t.as(owner, 'select public.save_ingredient($1, $2)', [bizOrg, ingredient({ allergens: ['gluten'] })])).rejects.toThrow()
  })
})

describe('oppskrifter: arbeidstid, emballasje og krysskontakt', () => {
  it('lagres og beholdes når eldre klienter ikke sender feltene', async () => {
    const id = await saveRecipe(owner, bizOrg, recipe())
    let row = (await t.su<{ labor: unknown[]; packaging_per_unit: string; cross_contact: string[] }>('select labor, packaging_per_unit, cross_contact from public.recipes where id = $1', [id]))[0]
    expect(row.labor).toHaveLength(1)
    expect(Number(row.packaging_per_unit)).toBe(2.5)
    expect(row.cross_contact).toEqual(['sesam'])

    const old = recipe({ id, name: 'Pizzadeig 2' }) as Record<string, unknown>
    delete old.labor; delete old.packaging_per_unit; delete old.cross_contact
    await saveRecipe(owner, bizOrg, old)
    row = (await t.su<{ labor: unknown[]; packaging_per_unit: string; cross_contact: string[] }>('select labor, packaging_per_unit, cross_contact from public.recipes where id = $1', [id]))[0]
    expect(row.labor).toHaveLength(1)
    expect(Number(row.packaging_per_unit)).toBe(2.5)
    expect(row.cross_contact).toEqual(['sesam'])
  })

  it('ugyldig arbeidstid og krysskontakt avvises', async () => {
    await expect(saveRecipe(owner, bizOrg, recipe({ labor: [{ roleId: 'x', people: -1, minutes: 10 }] }))).rejects.toThrow()
    await expect(saveRecipe(owner, bizOrg, recipe({ labor: { roleId: 'x' } }))).rejects.toThrow()
    await expect(saveRecipe(owner, bizOrg, recipe({ cross_contact: ['kokos'] }))).rejects.toThrow()
    await expect(saveRecipe(owner, bizOrg, recipe({ packaging_per_unit: -2 }))).rejects.toThrow()
  })
})

describe('underoppskrifter', () => {
  let sauce: string
  let pizza: string
  let flour: string

  beforeAll(async () => {
    flour = (await t.as<{ id: string }>(owner, 'select public.save_ingredient($1, $2) as id', [bizOrg, ingredient({ name: 'Tipo 00' })]))[0].id
    sauce = await saveRecipe(owner, bizOrg, recipe({ name: 'Tomatsaus', category: 'sauser' }), [{ ingredient_id: flour, amount: 100, unit: 'g' }])
    pizza = await saveRecipe(owner, bizOrg, recipe({ name: 'Margherita' }), [
      { ingredient_id: flour, amount: 250, unit: 'g' },
      { sub_recipe_id: sauce, amount: 150, unit: 'g' },
    ])
  })

  it('lagres og leses tilbake med sub_recipe_id', async () => {
    const lines = await t.as<{ ingredient_id: string | null; sub_recipe_id: string | null }>(owner,
      'select ingredient_id, sub_recipe_id from public.recipe_ingredients where recipe_id = $1 order by position', [pizza])
    expect(lines).toEqual([{ ingredient_id: flour, sub_recipe_id: null }, { ingredient_id: null, sub_recipe_id: sauce }])
  })

  it('PostgREST-innbyggingen er entydig med kolonnehint (recipe_ingredients!recipe_id)', async () => {
    const fks = await t.su<{ n: number }>(`select count(*)::int as n from pg_constraint where conrelid = 'public.recipe_ingredients'::regclass and confrelid = 'public.recipes'::regclass and contype = 'f'`)
    expect(fks[0].n).toBe(2)
  })

  it('sirkulære referanser stoppes, også over flere ledd', async () => {
    // Saus → pizza (pizza bruker allerede sausen)
    await expect(saveRecipe(owner, bizOrg, recipe({ id: sauce, name: 'Tomatsaus', category: 'sauser' }), [{ sub_recipe_id: pizza, amount: 1, unit: 'stk' }]))
      .rejects.toThrow(/sirkulær/i)
    // Oppskriften kan ikke bruke seg selv
    await expect(saveRecipe(owner, bizOrg, recipe({ id: pizza, name: 'Margherita' }), [{ sub_recipe_id: pizza, amount: 1, unit: 'stk' }]))
      .rejects.toThrow()
    // Sausen er uendret etter avvisningen (transaksjonen rulles tilbake)
    const lines = await t.su<{ ingredient_id: string }>('select ingredient_id from public.recipe_ingredients where recipe_id = $1', [sauce])
    expect(lines).toEqual([{ ingredient_id: flour }])
  })

  it('en linje kan ikke være både ingrediens og underoppskrift', async () => {
    await expect(saveRecipe(owner, bizOrg, recipe({ name: 'Feil' }), [{ ingredient_id: flour, sub_recipe_id: sauce, amount: 1, unit: 'g' }])).rejects.toThrow()
  })

  it('andre kunders oppskrifter kan ikke brukes som underoppskrift', async () => {
    await expect(saveRecipe(other, otherOrg, recipe({ name: 'Tyveri' }), [{ sub_recipe_id: sauce, amount: 100, unit: 'g' }])).rejects.toThrow()
  })

  it('sletting av underoppskriften beholder linjen uten kobling', async () => {
    const tmp = await saveRecipe(owner, bizOrg, recipe({ name: 'Pesto', category: 'sauser' }))
    const dish = await saveRecipe(owner, bizOrg, recipe({ name: 'Pasta' }), [{ sub_recipe_id: tmp, amount: 50, unit: 'g' }])
    await t.as(owner, 'delete from public.recipes where id = $1', [tmp])
    const lines = await t.su<{ sub_recipe_id: string | null }>('select sub_recipe_id from public.recipe_ingredients where recipe_id = $1', [dish])
    expect(lines).toEqual([{ sub_recipe_id: null }])
  })
})

describe('personal- og driftskostnader', () => {
  const settings = { staffRoles: [{ id: 'kokk', name: 'Kokk', mode: 'detaljert', hourlyWage: 250 }], operatingCosts: [{ id: 'h', name: 'Husleie', amountPerMonth: 30000 }], unitsPerMonth: 3000 }

  it('eier kan lagre, alle medlemmer kan lese', async () => {
    await t.as(owner, 'select public.save_cost_settings($1, $2)', [bizOrg, settings])
    const rows = await t.as<{ settings: typeof settings; updated_by: string }>(staff, 'select settings, updated_by from public.cost_settings where organization_id = $1', [bizOrg])
    expect(rows[0].settings.unitsPerMonth).toBe(3000)
    expect(rows[0].updated_by).toBe(owner)
  })

  it('vanlig medlem kan ikke endre', async () => {
    await expect(t.as(staff, 'select public.save_cost_settings($1, $2)', [bizOrg, { ...settings, unitsPerMonth: 1 }])).rejects.toThrow(/eier eller administrator/)
    await expect(t.as(staff, `update public.cost_settings set settings = '{}' where organization_id = $1`, [bizOrg])).rejects.toThrow()
    await expect(t.as(staff, `insert into public.cost_settings (organization_id, settings) values ($1, '{}')`, [bizOrg])).rejects.toThrow()
  })

  it('andre kunder kan verken lese eller endre', async () => {
    expect(await t.as(other, 'select * from public.cost_settings where organization_id = $1', [bizOrg])).toHaveLength(0)
    await expect(t.as(other, 'select public.save_cost_settings($1, $2)', [bizOrg, settings])).rejects.toThrow()
  })

  it('ikke-objekt avvises', async () => {
    await expect(t.as(owner, 'select public.save_cost_settings($1, $2)', [bizOrg, JSON.stringify([1, 2])])).rejects.toThrow()
  })
})

describe('timelønn bare for eier og administrator', () => {
  const role = { id: 'kokk', name: 'Kokk', mode: 'detaljert', hourlyWage: 200, holidayPayPercent: 12, pensionPercent: 2, employerTaxPercent: 14.1, otherPercent: 5, fixedHourlyCost: 0 }
  const fixed = { id: 'serv', name: 'Servitør', mode: 'ferdig', hourlyWage: 999, fixedHourlyCost: 330 }

  beforeAll(async () => {
    await t.as(owner, 'select public.save_cost_settings($1, $2)', [bizOrg, { staffRoles: [role, fixed], operatingCosts: [], unitsPerMonth: 100 }])
  })

  it('medlemmer får bare rollenavn og ferdig timekostnad, ingen lønnsdetaljer', async () => {
    const s = (await t.as<{ settings: { staffRoles: Record<string, unknown>[]; unitsPerMonth: number } }>(staff, 'select settings from public.cost_settings where organization_id = $1', [bizOrg]))[0].settings
    expect(s.unitsPerMonth).toBe(100)
    expect(s.staffRoles).toHaveLength(2)
    for (const r of s.staffRoles) {
      expect(Object.keys(r).sort()).toEqual(['fixedHourlyCost', 'id', 'mode', 'name'])
      expect(r.mode).toBe('ferdig')
    }
    // 200 × 1,14 × 1,141 + 200 × 0,05 = 270,148
    expect(Number(s.staffRoles[0].fixedHourlyCost)).toBeCloseTo(270.148, 3)
    expect(Number(s.staffRoles[1].fixedHourlyCost)).toBe(330)
    expect(JSON.stringify(s)).not.toContain('hourlyWage')
  })

  it('medlemmer kan ikke lese lønnstabellen; eier kan', async () => {
    expect(await t.as(staff, 'select * from public.staff_wages where organization_id = $1', [bizOrg])).toHaveLength(0)
    const w = (await t.as<{ roles: Record<string, unknown>[] }>(owner, 'select roles from public.staff_wages where organization_id = $1', [bizOrg]))[0].roles
    expect(w[0]).toMatchObject({ hourlyWage: 200, holidayPayPercent: 12 })
    expect(await t.as(other, 'select * from public.staff_wages where organization_id = $1', [bizOrg])).toHaveLength(0)
  })

  it('ingen kan skrive direkte i lønnstabellen', async () => {
    await expect(t.as(owner, `update public.staff_wages set roles = '[]' where organization_id = $1`, [bizOrg])).rejects.toThrow()
    await expect(t.as(staff, `insert into public.staff_wages (organization_id, roles) values ($1, '[]')`, [otherOrg])).rejects.toThrow()
  })

  it('eksporten har lønnsdetaljer for eier, men ikke for medlem', async () => {
    type Ex = { e: { organizations: { organization: { id: string }; staff_wages: unknown }[] } }
    const own = (await t.as<Ex>(owner, 'select public.export_my_data() as e'))[0].e.organizations.find((o) => o.organization.id === bizOrg)
    const mem = (await t.as<Ex>(staff, 'select public.export_my_data() as e'))[0].e.organizations.find((o) => o.organization.id === bizOrg)
    expect(own?.staff_wages).toBeTruthy()
    expect(mem?.staff_wages).toBeNull()
  })

  it('beregningsfunksjonene kan ikke kalles av klienter', async () => {
    await expect(t.as(staff, `select public.staff_role_hourly_cost('{}'::jsonb)`)).rejects.toThrow()
  })
})

describe('menyer', () => {
  let menuId: string
  const menu = (p: Record<string, unknown> = {}) => ({
    name: 'Lunsj', menu_type: 'lunsj', description: 'Hverdager',
    items: [{ id: 'i1', recipeId: 'r1', name: 'Dagens suppe', price: 149, vatPercent: 25 }], ...p,
  })

  it('medlem kan opprette og endre meny', async () => {
    menuId = (await t.as<{ id: string }>(staff, 'select public.save_menu($1, $2) as id', [bizOrg, menu()]))[0].id
    await t.as(staff, 'select public.save_menu($1, $2)', [bizOrg, menu({ id: menuId, name: 'Lunsj høst', menu_type: 'sesong' })])
    const row = (await t.su<{ name: string; menu_type: string; items: unknown[]; created_by: string }>('select name, menu_type, items, created_by from public.menus where id = $1', [menuId]))[0]
    expect(row).toMatchObject({ name: 'Lunsj høst', menu_type: 'sesong', created_by: staff })
    expect(row.items).toHaveLength(1)
  })

  it('ugyldig menytype avvises', async () => {
    await expect(t.as(owner, 'select public.save_menu($1, $2)', [bizOrg, menu({ menu_type: 'brunsj' })])).rejects.toThrow()
  })

  it('andre kunder kan verken lese, endre eller slette menyen', async () => {
    expect(await t.as(other, 'select * from public.menus where id = $1', [menuId])).toHaveLength(0)
    await t.as(other, 'select public.save_menu($1, $2)', [otherOrg, menu({ id: menuId, name: 'Kapret' })]).catch(() => null)
    expect(await t.as(other, 'delete from public.menus where id = $1 returning id', [menuId])).toHaveLength(0)
    const row = (await t.su<{ name: string; organization_id: string }>('select name, organization_id from public.menus where id = $1', [menuId]))[0]
    expect(row).toEqual({ name: 'Lunsj høst', organization_id: bizOrg })
    await expect(t.as(other, 'select public.save_menu($1, $2)', [bizOrg, menu()])).rejects.toThrow()
  })

  it('menyer og kostnadsoppsett er med i eksport av egne data', async () => {
    const ex = (await t.as<{ e: { organizations: { menus: unknown[]; cost_settings: unknown }[] } }>(owner, 'select public.export_my_data() as e'))[0].e
    expect(ex.organizations[0].menus).toHaveLength(1)
    expect(ex.organizations[0].cost_settings).toBeTruthy()
  })
})

describe('import av lokale data', () => {
  it('tar med allergener, nye oppskriftsfelt og underoppskrifter uansett rekkefølge', async () => {
    const res = (await t.as<{ r: { recipes_inserted: number; ingredients_inserted: number } }>(other, 'select public.import_local_data($1, $2) as r', [otherOrg, {
      ingredients: [{ local_id: 'ing-1', name: 'Melk', category: '', package_size: 1, unit: 'l', price: 20, store: '', price_updated: '2026-11-28', allergens: { melk: 'ja' }, allergens_checked: false }],
      recipes: [
        { local_id: 'rec-rett', name: 'Grateng', type: 'annet', category: 'hovedretter', yield_unit: 'porsjoner', yield_count: 4, packaging_per_unit: 3, cross_contact: ['egg'],
          ingredients: [{ ingredient_local_id: null, sub_recipe_local_id: 'rec-saus', amount: 200, unit: 'g' }] },
        { local_id: 'rec-saus', name: 'Hvit saus', type: 'annet', category: 'sauser', yield_count: 1, finished_weight_g: 500,
          ingredients: [{ ingredient_local_id: 'ing-1', sub_recipe_local_id: null, amount: 5, unit: 'dl' }] },
      ],
    }]))[0].r
    expect(res).toMatchObject({ recipes_inserted: 2, ingredients_inserted: 1 })
    const ing = (await t.su<{ allergens: unknown; allergens_checked: boolean }>(`select allergens, allergens_checked from public.ingredients where organization_id = $1 and local_id = 'ing-1'`, [otherOrg]))[0]
    expect(ing).toEqual({ allergens: { melk: 'ja' }, allergens_checked: false })
    const rett = (await t.su<{ id: string; category: string; yield_unit: string; cross_contact: string[] }>(`select id, category, yield_unit, cross_contact from public.recipes where organization_id = $1 and local_id = 'rec-rett'`, [otherOrg]))[0]
    expect(rett).toMatchObject({ category: 'hovedretter', yield_unit: 'porsjoner', cross_contact: ['egg'] })
    const line = (await t.su<{ name: string }>(`select r.name from public.recipe_ingredients ri join public.recipes r on r.id = ri.sub_recipe_id where ri.recipe_id = $1`, [rett.id]))[0]
    expect(line.name).toBe('Hvit saus')
  })
})
