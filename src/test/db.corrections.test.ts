// Databasetester for rettelsene etter gjennomgang av migrasjonene:
// negative strømpriser, uforanderlig historikk ved sletting, overlappende satser
// og aktiv organisasjon.
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './pgHarness'

let t: TestDb
let owner: string
let staff: string
let other: string
let ownerOrg: string
let otherOrg: string
let admin: string

const orgOf = async (uid: string) =>
  (await t.su<{ organization_id: string }>(`select organization_id from public.organization_members where user_id = $1 and role = 'owner'`, [uid]))[0].organization_id
const activeOf = async (uid: string) =>
  (await t.su<{ active_organization_id: string | null }>('select active_organization_id from public.user_settings where user_id = $1', [uid]))[0]?.active_organization_id

const insertHistory = (uid: string, org: string, values: Record<string, unknown> = {}) => {
  const v = { recipe_id: null, count: 3, kwh: 1.9, price_per_kwh: 1.35, electricity_cost: 2.57, ingredient_cost: 56.2, total_cost: 58.77, cost_per_item: 19.59, ...values }
  return t.as<{ id: string }>(uid,
    `insert into public.baking_history (organization_id, recipe_id, recipe_name, count, kwh, price_per_kwh, electricity_cost, ingredient_cost, total_cost, cost_per_item)
     values ($1, $2, 'Brød', $3, $4, $5, $6, $7, $8, $9) returning id`,
    [org, v.recipe_id, v.count, v.kwh, v.price_per_kwh, v.electricity_cost, v.ingredient_cost, v.total_cost, v.cost_per_item])
}

const tariff = (o: Record<string, unknown> = {}) => ({
  code: 'testsats', description: 'Test', value: 1, unit: 'kr/kWh', area: '', customer_type: '',
  valid_from: '2026-01-01', valid_to: '2026-12-31', source_url: 'https://example.com', verified_at: '2026-11-26', ...o,
})

beforeAll(async () => {
  t = await createTestDb()
  owner = await t.signUp('eier@bakeri.no', { full_name: 'Eier', account_type: 'business', organization_name: 'Bakeriet AS' })
  staff = await t.signUp('ansatt@bakeri.no', { full_name: 'Ansatt', account_type: 'private' })
  other = await t.signUp('annen@kunde.no', { full_name: 'Annen kunde', account_type: 'private' })
  admin = await t.signUp('system@eier.no', { full_name: 'Systemeier' })
  await t.su('insert into public.system_admins (user_id) values ($1)', [admin])
  ownerOrg = await orgOf(owner)
  otherOrg = await orgOf(other)
  await t.as(owner, `select public.add_member_by_email($1, 'ansatt@bakeri.no', 'member')`, [ownerOrg])
}, 60_000)

describe('negative strømpriser i historikken', () => {
  it('godtar negativ strømpris, strømkostnad, totalkostnad og kostnad per stk', async () => {
    const [{ id }] = await insertHistory(owner, ownerOrg, { price_per_kwh: -0.35, electricity_cost: -0.67, ingredient_cost: 0, total_cost: -0.67, cost_per_item: -0.2233 })
    const r = (await t.su<{ price_per_kwh: string; total_cost: string; cost_per_item: string }>('select price_per_kwh, total_cost, cost_per_item from public.baking_history where id = $1', [id]))[0]
    expect(Number(r.price_per_kwh)).toBe(-0.35)
    expect(Number(r.total_cost)).toBe(-0.67)
    expect(Number(r.cost_per_item)).toBe(-0.2233)
  })

  it('negativ total bakekostnad også med ingredienser', async () => {
    await insertHistory(owner, ownerOrg, { price_per_kwh: -2, electricity_cost: -10, ingredient_cost: 4, total_cost: -6, cost_per_item: -2 })
  })

  it('beholder validering av ingredienskostnad, kWh og antall', async () => {
    await expect(insertHistory(owner, ownerOrg, { ingredient_cost: -1 })).rejects.toThrow(/check constraint/)
    await expect(insertHistory(owner, ownerOrg, { kwh: -0.1 })).rejects.toThrow(/check constraint/)
    await expect(insertHistory(owner, ownerOrg, { count: 0 })).rejects.toThrow(/check constraint/)
  })
})

describe('uforanderlig historikk ved sletting', () => {
  it('sletting av oppskrift beholder historikken (recipe_id blir null)', async () => {
    const recipeId = (await t.as<{ id: string }>(owner, `select public.save_recipe($1, '{"name":"Rug","yield_count":2}', '[]') as id`, [ownerOrg]))[0].id
    const [{ id }] = await insertHistory(owner, ownerOrg, { recipe_id: recipeId })
    await t.as(owner, 'delete from public.recipes where id = $1', [recipeId])
    const h = (await t.su<{ recipe_id: string | null; total_cost: string }>('select recipe_id, total_cost from public.baking_history where id = $1', [id]))[0]
    expect(h.recipe_id).toBeNull()
    expect(Number(h.total_cost)).toBe(58.77)
  })

  it('sletting av bruker med historikk blokkeres ikke; created_by blir null og historikken beholdes', async () => {
    const [{ id }] = await insertHistory(staff, ownerOrg)
    const r = (await t.as<{ r: Record<string, number> }>(staff, `select public.delete_my_account('SLETT') as r`))[0].r
    expect(r.deleted_organizations).toBe(1) // ansattes egen private organisasjon
    const h = await t.su<{ created_by: string | null; total_cost: string; organization_id: string }>('select created_by, total_cost, organization_id from public.baking_history where id = $1', [id])
    expect(h).toHaveLength(1)
    expect(h[0].created_by).toBeNull()
    expect(h[0].organization_id).toBe(ownerOrg)
    expect(Number(h[0].total_cost)).toBe(58.77)
    expect((await t.su('select 1 from auth.users where id = $1', [staff])).length).toBe(0)
  })

  it('blokkerer ulovlige endringer – også fra serveren', async () => {
    const recipeId = (await t.as<{ id: string }>(owner, `select public.save_recipe($1, '{"name":"Hvete","yield_count":2}', '[]') as id`, [ownerOrg]))[0].id
    const recipe2 = (await t.as<{ id: string }>(owner, `select public.save_recipe($1, '{"name":"Spelt","yield_count":2}', '[]') as id`, [ownerOrg]))[0].id
    const [{ id }] = await insertHistory(owner, ownerOrg, { recipe_id: recipeId })

    await expect(t.su('update public.baking_history set recipe_id = $2 where id = $1', [id, recipe2])).rejects.toThrow(/HISTORY_IMMUTABLE/)
    await expect(t.su('update public.baking_history set created_by = $2 where id = $1', [id, other])).rejects.toThrow(/HISTORY_IMMUTABLE/)
    await expect(t.su('update public.baking_history set total_cost = 1 where id = $1', [id])).rejects.toThrow(/HISTORY_IMMUTABLE/)
    await expect(t.su('update public.baking_history set recipe_id = null, total_cost = 1 where id = $1', [id])).rejects.toThrow(/HISTORY_IMMUTABLE/)
    await expect(t.su('update public.baking_history set snapshot = \'{"x":1}\' where id = $1', [id])).rejects.toThrow(/HISTORY_IMMUTABLE/)
    // Klienter har ingen UPDATE-rettighet i det hele tatt
    await expect(t.as(owner, 'update public.baking_history set recipe_id = null where id = $1', [id])).rejects.toThrow(/permission denied/)
    await expect(t.as(owner, 'update public.baking_history set created_by = null where id = $1', [id])).rejects.toThrow(/permission denied/)
    // Det fremmednøklene gjør (verdi -> NULL) er tillatt på serveren
    await t.su('update public.baking_history set recipe_id = null, created_by = null where id = $1', [id])
    // ... men ikke fra NULL tilbake til en UUID
    await expect(t.su('update public.baking_history set created_by = $2 where id = $1', [id, owner])).rejects.toThrow(/HISTORY_IMMUTABLE/)
  })
})

describe('overlappende strømprissatser', () => {
  it('avviser overlapp for samme kode, område og kundetype', async () => {
    await t.as(admin, 'select public.admin_upsert_tariff($1)', [tariff()])
    await expect(t.as(admin, 'select public.admin_upsert_tariff($1)', [tariff({ valid_from: '2026-06-01', valid_to: '2027-06-30' })])).rejects.toThrow(/electricity_tariffs_no_overlap/)
    // Overlapp på én dag (inklusive grenser)
    await expect(t.as(admin, 'select public.admin_upsert_tariff($1)', [tariff({ valid_from: '2026-12-31', valid_to: '2027-12-31' })])).rejects.toThrow(/exclusion constraint/)
  })

  it('tillater perioder som ligger inntil hverandre', async () => {
    await t.as(admin, 'select public.admin_upsert_tariff($1)', [tariff({ valid_from: '2027-01-01', valid_to: '2027-12-31' })])
  })

  it('åpen periode (valid_to = NULL) blokkerer alle senere perioder', async () => {
    await t.as(admin, 'select public.admin_upsert_tariff($1)', [tariff({ code: 'aapen', valid_from: '2026-01-01', valid_to: '' })])
    await expect(t.as(admin, 'select public.admin_upsert_tariff($1)', [tariff({ code: 'aapen', valid_from: '2040-01-01', valid_to: '2040-12-31' })])).rejects.toThrow(/exclusion constraint/)
    await expect(t.as(admin, 'select public.admin_upsert_tariff($1)', [tariff({ code: 'aapen', valid_from: '2030-01-01', valid_to: '' })])).rejects.toThrow(/exclusion constraint/)
  })

  it('en åpen sats kan avsluttes og etterfølges av en ny', async () => {
    const id = (await t.su<{ id: string }>(`select id from public.electricity_tariffs where code = 'aapen'`))[0].id
    await t.as(admin, 'select public.admin_upsert_tariff($1)', [tariff({ id, code: 'aapen', valid_from: '2026-01-01', valid_to: '2026-12-31' })])
    await t.as(admin, 'select public.admin_upsert_tariff($1)', [tariff({ code: 'aapen', valid_from: '2027-01-01', valid_to: '' })])
  })

  it('endring av eksisterende sats kan ikke skape overlapp', async () => {
    const id = (await t.su<{ id: string }>(`select id from public.electricity_tariffs where code = 'testsats' and valid_from = '2027-01-01'`))[0].id
    await expect(t.as(admin, 'select public.admin_upsert_tariff($1)', [tariff({ id, valid_from: '2026-11-01', valid_to: '2027-12-31' })])).rejects.toThrow(/exclusion constraint/)
  })

  it('generelle, kundetype- og områdespesifikke satser kan gjelde samtidig, med entydig prioritering', async () => {
    await t.as(admin, 'select public.admin_upsert_tariff($1)', [tariff({ code: 'prio', value: 1 })])
    await t.as(admin, 'select public.admin_upsert_tariff($1)', [tariff({ code: 'prio', value: 2, customer_type: 'privat' })])
    await t.as(admin, 'select public.admin_upsert_tariff($1)', [tariff({ code: 'prio', value: 3, area: 'NO4' })])
    await t.as(admin, 'select public.admin_upsert_tariff($1)', [tariff({ code: 'prio', value: 4, area: 'NO4', customer_type: 'privat' })])
    const pick = async (area: string | null, ct: string | null) =>
      Number((await t.asAnon<{ value: string }>(`select value from public.resolve_electricity_tariff('prio', '2026-07-01', $1, $2)`, [area, ct]))[0].value)
    expect(await pick('NO4', 'privat')).toBe(4)
    expect(await pick('NO4', 'bedrift')).toBe(3)
    expect(await pick('NO1', 'privat')).toBe(2)
    expect(await pick('NO1', 'bedrift')).toBe(1)
    expect(await t.asAnon(`select * from public.resolve_electricity_tariff('prio', '2030-01-01', 'NO1', 'privat')`)).toHaveLength(0)
  })

  it('begrensningen ligger i databasen (EXCLUDE) og gjelder alle skrivinger, også direkte SQL', async () => {
    const c = await t.su<{ contype: string }>(`select contype from pg_constraint where conname = 'electricity_tariffs_no_overlap'`)
    expect(c[0].contype).toBe('x')
    await expect(t.su(`insert into public.electricity_tariffs (code, description, value, unit, valid_from, valid_to, source_url, verified_at)
      values ('testsats', 'x', 1, 'kr', '2026-03-01', '2026-03-31', 'https://x', '2026-01-01')`)).rejects.toThrow(/exclusion constraint/)
  })
})

describe('aktiv organisasjon', () => {
  let member: string
  let memberOwnOrg: string
  beforeAll(async () => {
    member = await t.signUp('medlem@bakeri.no', { full_name: 'Medlem' })
    memberOwnOrg = await orgOf(member)
    await t.as(owner, `select public.add_member_by_email($1, 'medlem@bakeri.no', 'member')`, [ownerOrg])
  })

  it('registrering setter egen organisasjon som aktiv (atomisk)', async () => {
    expect(await activeOf(member)).toBe(memberOwnOrg)
  })

  it('kan bytte til en organisasjon man er medlem av', async () => {
    await t.as(member, 'update public.user_settings set active_organization_id = $1 where user_id = $2', [ownerOrg, member])
    expect(await activeOf(member)).toBe(ownerOrg)
  })

  it('kan ikke velge en annen kundes organisasjon (RLS)', async () => {
    await expect(t.as(member, 'update public.user_settings set active_organization_id = $1 where user_id = $2', [otherOrg, member])).rejects.toThrow(/row-level security/)
    expect(await activeOf(member)).toBe(ownerOrg)
  })

  it('håndheves i databasen også uten RLS (fremmednøkkel mot medlemskap)', async () => {
    await expect(t.su('update public.user_settings set active_organization_id = $1 where user_id = $2', [otherOrg, member])).rejects.toThrow(/foreign key/)
    await expect(t.su('insert into public.user_settings (user_id, active_organization_id) values ($1, $2) on conflict (user_id) do update set active_organization_id = excluded.active_organization_id', [member, otherOrg])).rejects.toThrow(/foreign key/)
  })

  it('når medlemskapet fjernes, flyttes aktiv organisasjon til et gjenværende medlemskap', async () => {
    await t.as(owner, 'select public.remove_member($1, $2)', [ownerOrg, member])
    expect(await activeOf(member)).toBe(memberOwnOrg)
    expect((await t.as<{ c: { organizations: { id: string }[] } }>(member, 'select public.get_my_context() as c'))[0].c.organizations.map((o) => o.id)).toEqual([memberOwnOrg])
  })

  it('forlater man organisasjonen, flyttes aktiv organisasjon også', async () => {
    await t.as(owner, `select public.add_member_by_email($1, 'medlem@bakeri.no', 'member')`, [ownerOrg])
    await t.as(member, 'update public.user_settings set active_organization_id = $1 where user_id = $2', [ownerOrg, member])
    await t.as(member, 'select public.leave_organization($1)', [ownerOrg])
    expect(await activeOf(member)).toBe(memberOwnOrg)
  })

  it('sletting av organisasjon fungerer og flytter andre medlemmers aktive organisasjon', async () => {
    await t.as(owner, `select public.add_member_by_email($1, 'medlem@bakeri.no', 'member')`, [ownerOrg])
    await t.as(member, 'update public.user_settings set active_organization_id = $1 where user_id = $2', [ownerOrg, member])
    await t.su('delete from public.organizations where id = $1', [ownerOrg])
    expect(await activeOf(member)).toBe(memberOwnOrg)
    expect(await activeOf(owner)).toBeNull() // eieren har ingen andre medlemskap
  })

  it('bruker uten gjenværende medlemskap får null, og sletting av kontoen fungerer', async () => {
    const r = (await t.as<{ r: Record<string, number> }>(owner, `select public.delete_my_account('SLETT') as r`))[0].r
    expect(r.deleted_organizations).toBe(0)
    expect((await t.su('select 1 from public.user_settings where user_id = $1', [owner])).length).toBe(0)
  })
})
