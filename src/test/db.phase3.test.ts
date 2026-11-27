// Databasetester for fase 3: AI-skanning med kvoter, hastighetsgrense,
// kostnadstak og forbruksregistrering. Kjører de ekte migrasjonene i PGlite.
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './pgHarness'

let t: TestDb
let admin: string
let owner: string
let staff: string
let other: string
let bizOrg: string
let otherOrg: string

const orgOf = async (uid: string) =>
  (await t.su<{ organization_id: string }>('select organization_id from public.organization_members where user_id = $1 and role = $2', [uid, 'owner']))[0].organization_id
const reserve = (org: string, uid: string, kind = 'oppskrift') =>
  t.service<{ r: { id: string; model: string; used: number; limit: number } }>('select public.reserve_ai_scan($1, $2, $3) as r', [org, uid, kind]).then((x) => x[0].r)
const finish = (id: string, ok: boolean, inT = 1000, outT = 200, err: string | null = null) =>
  t.service('select public.finish_ai_scan($1, $2, $3, $4, $5)', [id, ok, inT, outT, err])
const enable = (p: Record<string, unknown> = {}) =>
  t.as(admin, 'select public.admin_set_ai_settings($1)', [{ enabled: true, monthly_cost_limit_usd: 50, max_scans_per_minute: 100, ...p }])
const clearUsage = () => t.su('delete from public.ai_usage')

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
}, 60_000)

describe('standardoppsett', () => {
  it('AI er av, med Claude Haiku 5.5 og listepriser som standard', async () => {
    const s = (await t.su<{ enabled: boolean; model: string; input_usd_per_mtok: string; output_usd_per_mtok: string; monthly_cost_limit_usd: string }>('select * from public.ai_settings'))[0]
    expect(s).toMatchObject({ enabled: false, model: 'claude-haiku-5-5' })
    expect(Number(s.input_usd_per_mtok)).toBe(0.1)
    expect(Number(s.output_usd_per_mtok)).toBe(0.5)
    expect(Number(s.monthly_cost_limit_usd)).toBe(0)
  })

  it('kvoter per plan: Free 3, Plus 30, Pro 200', async () => {
    const rows = await t.su<{ plan: string; ai_scans_per_month: number }>('select plan, ai_scans_per_month from public.plan_features order by plan')
    expect(Object.fromEntries(rows.map((r) => [r.plan, r.ai_scans_per_month]))).toMatchObject({ free: 3, plus: 30, pro: 200 })
  })

  it('kvoten følger med i get_my_context (features)', async () => {
    const ctx = (await t.as<{ c: { organizations: { features: { ai_scans_per_month: number } }[] } }>(owner, 'select public.get_my_context() as c'))[0].c
    expect(ctx.organizations[0].features.ai_scans_per_month).toBe(200) // prøveperiode = Pro
  })

  it('get_ai_status viser av, brukt og grense', async () => {
    const s = (await t.as<{ s: { enabled: boolean; used: number; limit: number } }>(staff, 'select public.get_ai_status($1) as s', [bizOrg]))[0].s
    expect(s).toMatchObject({ enabled: false, used: 0, limit: 200 })
    await expect(t.as(other, 'select public.get_ai_status($1)', [bizOrg])).rejects.toThrow()
  })

  it('reservasjon avvises når AI er av', async () => {
    await expect(reserve(bizOrg, owner)).rejects.toThrow('AI_DISABLED')
  })
})

describe('tilgang', () => {
  it('innloggede brukere kan verken lese innstillingene eller reservere/avslutte selv', async () => {
    await expect(t.as(owner, 'select * from public.ai_settings')).rejects.toThrow()
    await expect(t.as(owner, 'select public.reserve_ai_scan($1, $2, $3)', [bizOrg, owner, 'oppskrift'])).rejects.toThrow()
    await expect(t.as(owner, `select public.finish_ai_scan(gen_random_uuid(), true, 1, 1, null)`)).rejects.toThrow()
    await expect(t.asAnon('select public.get_ai_status($1)', [bizOrg])).rejects.toThrow()
  })

  it('bare systemadministrator kan endre innstillinger og kvoter', async () => {
    await expect(t.as(owner, 'select public.admin_set_ai_settings($1)', [{ enabled: true }])).rejects.toThrow()
    await expect(t.as(owner, `select public.admin_set_ai_quota('free', 1000)`)).rejects.toThrow()
    await expect(t.as(owner, 'select public.admin_get_ai_settings()')).rejects.toThrow()
  })

  it('ugyldig modellnavn og negative priser avvises', async () => {
    await expect(t.as(admin, 'select public.admin_set_ai_settings($1)', [{ model: 'Haiku; drop table' }])).rejects.toThrow()
    await expect(t.as(admin, 'select public.admin_set_ai_settings($1)', [{ input_usd_per_mtok: -1 }])).rejects.toThrow()
  })

  it('AI er fortsatt av når kostnadstaket er 0', async () => {
    await t.as(admin, 'select public.admin_set_ai_settings($1)', [{ enabled: true, monthly_cost_limit_usd: 0 }])
    await expect(reserve(bizOrg, owner)).rejects.toThrow('AI_DISABLED')
    const s = (await t.as<{ s: { enabled: boolean } }>(owner, 'select public.get_ai_status($1) as s', [bizOrg]))[0].s
    expect(s.enabled).toBe(false)
  })

  it('brukeren må være medlem av organisasjonen', async () => {
    await enable()
    await expect(reserve(bizOrg, other)).rejects.toThrow('FORBIDDEN')
  })
})

describe('kvote, kostnad og forbruk', () => {
  it('registrerer modell, tokens og kostnad fra prisene', async () => {
    await clearUsage()
    await enable({ model: 'claude-haiku-5-5', input_usd_per_mtok: 0.1, output_usd_per_mtok: 0.5 })
    const r = await reserve(bizOrg, staff, 'kvittering')
    expect(r).toMatchObject({ model: 'claude-haiku-5-5', used: 1, limit: 200 })
    await finish(r.id, true, 2_000_000, 100_000)
    const row = (await t.su<{ status: string; cost_usd: string; input_tokens: number; kind: string; user_id: string }>('select * from public.ai_usage where id = $1', [r.id]))[0]
    expect(row).toMatchObject({ status: 'ok', input_tokens: 2_000_000, kind: 'kvittering', user_id: staff })
    expect(Number(row.cost_usd)).toBeCloseTo(0.2 + 0.05)
    // Kan ikke avsluttes to ganger
    await finish(r.id, false, 1, 1, 'X')
    expect((await t.su<{ status: string }>('select status from public.ai_usage where id = $1', [r.id]))[0].status).toBe('ok')
  })

  it('kvoten håndheves, og feilede skanninger teller ikke', async () => {
    await clearUsage()
    await t.as(admin, `select public.admin_set_ai_quota('pro', 2)`)
    const a = await reserve(bizOrg, owner)
    await finish(a.id, false, 500, 0, 'PROVIDER_ERROR') // feilet → teller ikke
    const b = await reserve(bizOrg, owner)
    await finish(b.id, true)
    const c = await reserve(bizOrg, staff)
    await finish(c.id, true)
    await expect(reserve(bizOrg, owner)).rejects.toThrow('QUOTA_EXCEEDED')
    // Andre kunder påvirkes ikke
    const d = await reserve(otherOrg, other)
    expect(d.used).toBe(1)
    const s = (await t.as<{ s: { used: number; limit: number } }>(owner, 'select public.get_ai_status($1) as s', [bizOrg]))[0].s
    expect(s).toMatchObject({ used: 2, limit: 2 })
    await t.as(admin, `select public.admin_set_ai_quota('pro', 200)`)
  })

  it('pågående reservasjoner teller mot kvoten (samtidige forespørsler slipper ikke forbi)', async () => {
    await clearUsage()
    await t.as(admin, `select public.admin_set_ai_quota('pro', 2)`)
    await reserve(bizOrg, owner)
    await reserve(bizOrg, staff)
    await expect(reserve(bizOrg, owner)).rejects.toThrow('QUOTA_EXCEEDED')
    // Gamle, hengende reservasjoner (over 10 min) frigjøres
    await t.su(`update public.ai_usage set created_at = now() - interval '11 minutes' where organization_id = $1`, [bizOrg])
    await expect(reserve(bizOrg, owner)).resolves.toBeTruthy()
    await t.as(admin, `select public.admin_set_ai_quota('pro', 200)`)
  })

  it('hastighetsgrense per bruker', async () => {
    await clearUsage()
    await enable({ max_scans_per_minute: 2 })
    await reserve(bizOrg, owner)
    await reserve(bizOrg, owner)
    await expect(reserve(bizOrg, owner)).rejects.toThrow('RATE_LIMITED')
    await expect(reserve(bizOrg, staff)).resolves.toBeTruthy() // annen bruker
    await enable({ max_scans_per_minute: 100 })
  })

  it('samlet kostnadstak for måneden', async () => {
    await clearUsage()
    await enable({ monthly_cost_limit_usd: 1, estimated_cost_per_scan_usd: 0.01 })
    const r = await reserve(bizOrg, owner)
    await finish(r.id, true, 9_000_000, 0) // 0,90 USD
    await reserve(otherOrg, other) // 0,90 + 0,01 + 0,01 = 0,92 ≤ 1
    await t.su(`update public.ai_usage set cost_usd = 0.99 where id = $1`, [r.id])
    await expect(reserve(bizOrg, staff)).rejects.toThrow('COST_LIMIT')
    await enable({ monthly_cost_limit_usd: 50 })
  })

  it('medlemmer ser bare egen organisasjons forbruk, og eksporten har ikke bruker-id', async () => {
    expect((await t.as<{ organization_id: string }>(other, 'select organization_id from public.ai_usage')).every((r) => r.organization_id === otherOrg)).toBe(true)
    expect((await t.as(staff, 'select * from public.ai_usage')).length).toBeGreaterThan(0)
    await expect(t.as(staff, `update public.ai_usage set cost_usd = 0`)).rejects.toThrow()
    const ex = (await t.as<{ e: { organizations: { ai_usage: Record<string, unknown>[] }[] } }>(owner, 'select public.export_my_data() as e'))[0].e
    const usage = ex.organizations[0].ai_usage
    expect(usage.length).toBeGreaterThan(0)
    expect(usage[0]).not.toHaveProperty('user_id')
  })

  it('admin ser månedsforbruk', async () => {
    const a = (await t.as<{ a: { settings: { enabled: boolean }; month: { scans: number; cost_usd: string } } }>(admin, 'select public.admin_get_ai_settings() as a'))[0].a
    expect(a.settings.enabled).toBe(true)
    expect(a.month.scans).toBeGreaterThan(0)
  })
})
