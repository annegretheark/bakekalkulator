// Databasetester for fase 1: virksomhetstype, utstyrsregister og matoppskrifter.
// Kjører de ekte migrasjonene i PGlite (ingenting mot den eksterne databasen).
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './pgHarness'

let t: TestDb
let priv: string
let owner: string
let staff: string
let other: string
let privOrg: string
let bizOrg: string
let otherOrg: string

const orgOf = async (uid: string) =>
  (await t.su<{ organization_id: string }>('select organization_id from public.organization_members where user_id = $1 and role = $2', [uid, 'owner']))[0].organization_id
const businessTypeOf = async (org: string) =>
  (await t.su<{ business_type: string }>('select business_type from public.organizations where id = $1', [org]))[0].business_type

const equipment = (p: Record<string, unknown> = {}) => ({
  name: 'Dekkovn', equipment_type: 'bakerovn', manufacturer: 'Sveba', model: 'S-400', watt: 12000, minutes: 60,
  power_factor_percent: 50, preheat_minutes: 30, preheat_power_percent: 100, measured_kwh: null, output_per_run: 40,
  continuous: false, hours_per_day: 24, is_estimate: true, comment: '', ...p,
})

beforeAll(async () => {
  t = await createTestDb()
  priv = await t.signUp('privat@example.com', { full_name: 'Privat', account_type: 'private', business_type: 'restaurant' })
  owner = await t.signUp('eier@restaurant.no', { full_name: 'Eier', account_type: 'business', organization_name: 'Restauranten AS', business_type: 'restaurant' })
  staff = await t.signUp('ansatt@restaurant.no', { full_name: 'Ansatt', account_type: 'private' })
  other = await t.signUp('annen@kafe.no', { full_name: 'Annen', account_type: 'business', organization_name: 'Kafeen', business_type: 'ugyldig' })
  privOrg = await orgOf(priv)
  bizOrg = await orgOf(owner)
  otherOrg = await orgOf(other)
  await t.as(owner, `select public.add_member_by_email($1, 'ansatt@restaurant.no', 'member')`, [bizOrg])
}, 60_000)

describe('virksomhetstype', () => {
  it('settes ved registrering: privatperson er alltid «privat», ugyldig verdi blir «annet»', async () => {
    expect(await businessTypeOf(privOrg)).toBe('privat')
    expect(await businessTypeOf(bizOrg)).toBe('restaurant')
    expect(await businessTypeOf(otherOrg)).toBe('annet')
  })

  it('eldre klienter uten business_type gir «annet» for bedrifter', async () => {
    const u = await t.signUp('gammel@bedrift.no', { full_name: 'G', account_type: 'business', organization_name: 'Gammel AS' })
    expect(await businessTypeOf(await orgOf(u))).toBe('annet')
  })

  it('fylles ut når den mangler ved innsetting (eksisterende rader / eldre kode)', async () => {
    const rows = await t.su<{ business_type: string }>(`insert into public.organizations (name, type) values ('Uten type', 'business') returning business_type`)
    expect(rows[0].business_type).toBe('annet')
  })

  it('vises i get_my_context', async () => {
    const ctx = (await t.as<{ c: { organizations: { id: string; business_type: string }[] } }>(owner, 'select public.get_my_context() as c'))[0].c
    expect(ctx.organizations.find((o) => o.id === bizOrg)?.business_type).toBe('restaurant')
  })

  it('eier kan endre virksomhetstype', async () => {
    const rows = await t.as(owner, `update public.organizations set business_type = 'catering' where id = $1 returning id`, [bizOrg])
    expect(rows).toHaveLength(1)
    expect(await businessTypeOf(bizOrg)).toBe('catering')
    await t.as(owner, `update public.organizations set business_type = 'restaurant' where id = $1`, [bizOrg])
  })

  it('vanlig medlem kan ikke endre virksomhetstype', async () => {
    const rows = await t.as(staff, `update public.organizations set business_type = 'kantine' where id = $1 returning id`, [bizOrg])
    expect(rows).toHaveLength(0)
    expect(await businessTypeOf(bizOrg)).toBe('restaurant')
  })

  it('bedrift kan ikke bli «privat», og privatperson kan ikke få bedriftstype', async () => {
    await expect(t.as(owner, `update public.organizations set business_type = 'privat' where id = $1`, [bizOrg])).rejects.toThrow()
    await expect(t.as(priv, `update public.organizations set business_type = 'bakeri' where id = $1`, [privOrg])).rejects.toThrow()
  })

  it('ugyldig verdi avvises', async () => {
    await expect(t.as(owner, `update public.organizations set business_type = 'rakett' where id = $1`, [bizOrg])).rejects.toThrow()
  })

  it('andre kunder kan ikke endre organisasjonen', async () => {
    const rows = await t.as(other, `update public.organizations set business_type = 'kafe' where id = $1 returning id`, [bizOrg])
    expect(rows).toHaveLength(0)
  })
})

describe('utstyrsregister', () => {
  let eqId: string

  it('medlem kan lagre utstyr med alle felt via save_equipment', async () => {
    eqId = (await t.as<{ id: string }>(staff, 'select public.save_equipment($1, $2) as id', [bizOrg, equipment()]))[0].id
    const row = (await t.su<Record<string, unknown>>('select * from public.equipment where id = $1', [eqId]))[0]
    expect(row).toMatchObject({ name: 'Dekkovn', equipment_type: 'bakerovn', manufacturer: 'Sveba', model: 'S-400', output_per_run: 40, is_estimate: true, continuous: false })
    expect(Number(row.preheat_minutes)).toBe(30)
  })

  it('redigering oppdaterer samme rad', async () => {
    await t.as(owner, 'select public.save_equipment($1, $2)', [bizOrg, equipment({ id: eqId, watt: 15000, measured_kwh: 8.5, is_estimate: false })])
    const rows = await t.su<{ watt: string; measured_kwh: string; is_estimate: boolean }>('select watt, measured_kwh, is_estimate from public.equipment where organization_id = $1', [bizOrg])
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].watt)).toBe(15000)
    expect(Number(rows[0].measured_kwh)).toBe(8.5)
    expect(rows[0].is_estimate).toBe(false)
  })

  it('andre kunder kan verken lagre i, lese eller endre utstyret', async () => {
    await expect(t.as(other, 'select public.save_equipment($1, $2)', [bizOrg, equipment()])).rejects.toThrow(/FORBIDDEN/)
    expect(await t.as(other, 'select * from public.equipment where organization_id = $1', [bizOrg])).toHaveLength(0)
    // Samme id i egen organisasjon: oppdaterer ikke den andre kundens rad, og insert med samme id feiler
    await expect(t.as(other, 'select public.save_equipment($1, $2)', [otherOrg, equipment({ id: eqId, name: 'Kapret' })])).rejects.toThrow()
    expect((await t.su<{ name: string }>('select name from public.equipment where id = $1', [eqId]))[0].name).toBe('Dekkovn')
  })

  it('kontinuerlig utstyr lagres med driftstimer', async () => {
    const id = (await t.as<{ id: string }>(owner, 'select public.save_equipment($1, $2) as id',
      [bizOrg, equipment({ name: 'Kjølerom', equipment_type: 'kjoleskap', watt: 800, minutes: 0, power_factor_percent: 35, preheat_minutes: 0, continuous: true, hours_per_day: 24 })]))[0].id
    expect((await t.su<{ continuous: boolean }>('select continuous from public.equipment where id = $1', [id]))[0].continuous).toBe(true)
  })

  it('ugyldige verdier avvises av databasen', async () => {
    await expect(t.as(owner, 'select public.save_equipment($1, $2)', [bizOrg, equipment({ equipment_type: 'rakett' })])).rejects.toThrow()
    await expect(t.as(owner, 'select public.save_equipment($1, $2)', [bizOrg, equipment({ watt: 0 })])).rejects.toThrow()
    await expect(t.as(owner, 'select public.save_equipment($1, $2)', [bizOrg, equipment({ hours_per_day: 25 })])).rejects.toThrow()
  })

  it('identitetsfelt kan ikke endres', async () => {
    await expect(t.as(owner, `update public.equipment set organization_id = $1 where id = $2`, [otherOrg, eqId])).rejects.toThrow()
  })

  it('anonyme har ikke tilgang til save_equipment', async () => {
    await expect(t.asAnon('select public.save_equipment(gen_random_uuid(), \'{}\')')).rejects.toThrow()
  })

  it('utstyr er med i eksport av egne data', async () => {
    const exp = (await t.as<{ e: { organizations: { organization: { id: string }; equipment: { name: string }[] }[] } }>(owner, 'select public.export_my_data() as e'))[0].e
    expect(exp.organizations.find((o) => o.organization.id === bizOrg)?.equipment.map((e) => e.name)).toContain('Dekkovn')
  })
})

describe('matoppskrifter', () => {
  const recipe = (p: Record<string, unknown> = {}) => ({
    name: 'Lasagne', type: 'annet', category: 'hovedretter', yield_unit: 'porsjoner', yield_count: 8, steps: ['Lag sausen'],
    prep_minutes: 40, rise_minutes: 0, bake_minutes: 45, finished_weight_g: 2400, store_price_per_item: 0, notes: '',
    energy: { energySource: 'equipment', equipmentUses: [] }, ...p,
  })

  it('save_recipe lagrer kategori, porsjoner, tilberedningstid og ferdig vekt', async () => {
    const id = (await t.as<{ id: string }>(owner, `select public.save_recipe($1, $2, '[]') as id`, [bizOrg, recipe()]))[0].id
    const row = (await t.su<Record<string, unknown>>('select * from public.recipes where id = $1', [id]))[0]
    expect(row).toMatchObject({ category: 'hovedretter', yield_unit: 'porsjoner', prep_minutes: 40 })
    expect(Number(row.finished_weight_g)).toBe(2400)
    expect((row.energy as { energySource: string }).energySource).toBe('equipment')

    await t.as(owner, `select public.save_recipe($1, $2, '[]')`, [bizOrg, recipe({ id, category: 'catering', finished_weight_g: null })])
    const updated = (await t.su<{ category: string; finished_weight_g: string | null }>('select category, finished_weight_g from public.recipes where id = $1', [id]))[0]
    expect(updated).toEqual({ category: 'catering', finished_weight_g: null })
  })

  it('eldre klienter uten nye felt får standardverdier', async () => {
    const id = (await t.as<{ id: string }>(priv, `select public.save_recipe($1, $2, '[]') as id`,
      [privOrg, { name: 'Brød', type: 'brod', yield_count: 2 }]))[0].id
    const row = (await t.su<{ category: string; yield_unit: string; prep_minutes: number }>('select category, yield_unit, prep_minutes from public.recipes where id = $1', [id]))[0]
    expect(row).toEqual({ category: 'annet', yield_unit: 'stk', prep_minutes: 0 })
  })

  it('ugyldig kategori og porsjonsenhet avvises', async () => {
    await expect(t.as(owner, `select public.save_recipe($1, $2, '[]')`, [bizOrg, recipe({ category: 'snacks' })])).rejects.toThrow()
    await expect(t.as(owner, `select public.save_recipe($1, $2, '[]')`, [bizOrg, recipe({ yield_unit: 'kg' })])).rejects.toThrow()
  })

  it('import av lokale data virker fortsatt (nye felt får standardverdi)', async () => {
    const res = (await t.as<{ r: { recipes_inserted: number } }>(priv, 'select public.import_local_data($1, $2) as r',
      [privOrg, { ingredients: [], recipes: [{ local_id: 'lok-1', name: 'Boller', type: 'boller', yield_count: 12, ingredients: [] }] }]))[0].r
    expect(res.recipes_inserted).toBe(1)
  })
})
