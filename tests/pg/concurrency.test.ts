// Samtidighetstester mot EKTE PostgreSQL. Krever flere tilkoblinger og kan derfor
// ikke kjøres i PGlite. Kjør med: npm run test:pg
//
// Hver test åpner flere tilkoblinger som opptrer som innloggede brukere (samme rolle
// og JWT-claims som PostgREST bruker), starter transaksjoner samtidig og holder dem
// åpne (pg_sleep) for å fremprovosere kappløp.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { createRealDb, inTx, type RealDb } from './realHarness'

let db: RealDb

const orgOf = async (uid: string) =>
  (await db.admin.query<{ organization_id: string }>(`select organization_id from public.organization_members where user_id = $1 and role = 'owner'`, [uid])).rows[0].organization_id
const setPlan = (org: string, plan: 'free' | 'plus' | 'pro') =>
  db.admin.query(`update public.subscriptions set plan = $2, status = 'active', current_period_end = null where organization_id = $1`, [org, plan])
const count = async (sql: string, params: unknown[]) => Number((await db.admin.query<{ n: string }>(sql, params)).rows[0].n)
const HOLD = 'select pg_sleep(0.3)' // hold transaksjonen åpen så de andre må vente

beforeAll(async () => { db = await createRealDb('concurrency') })
afterAll(async () => { await db?.close() })

describe('plangrenser ved samtidige transaksjoner', () => {
  it('samtidige nye oppskrifter kan ikke passere max_recipes (REST-insert)', async () => {
    const u = await db.signUp('rec@example.com', { full_name: 'R' })
    const org = await orgOf(u)
    await setPlan(org, 'free') // maks 5
    const c0 = await db.connectAs(u)
    for (let i = 0; i < 3; i++) await c0.query(`insert into public.recipes (organization_id, name, yield_count) values ($1, $2, 1)`, [org, `Start ${i}`])

    const clients = await Promise.all(Array.from({ length: 6 }, () => db.connectAs(u)))
    const results = await Promise.all(clients.map((c, i) => inTx(c, async (tx) => {
      await tx.query(`insert into public.recipes (organization_id, name, yield_count) values ($1, $2, 1)`, [org, `Samtidig ${i}`])
      await tx.query(HOLD)
    })))
    expect(results.filter((r) => r.ok)).toHaveLength(2)
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && /PLAN_LIMIT/.test(r.error.message))).toBe(true)
    expect(await count('select count(*) n from public.recipes where organization_id = $1', [org])).toBe(5)
  })

  it('samtidige nye ingredienser via RPC kan ikke passere max_ingredients', async () => {
    const u = await db.signUp('ing@example.com', { full_name: 'I' })
    const org = await orgOf(u)
    await setPlan(org, 'free') // maks 50
    await db.admin.query(`insert into public.ingredients (organization_id, name, package_size, unit, price)
      select $1, 'Ing ' || g, 1, 'kg', 1 from generate_series(1, 48) g`, [org])
    const clients = await Promise.all(Array.from({ length: 5 }, () => db.connectAs(u)))
    const results = await Promise.all(clients.map((c, i) => inTx(c, async (tx) => {
      await tx.query(`select public.save_ingredient($1, $2)`, [org, { name: `Ny ${i}`, package_size: 1, unit: 'kg', price: 1 }])
      await tx.query(HOLD)
    })))
    expect(results.filter((r) => r.ok)).toHaveLength(2)
    expect(await count('select count(*) n from public.ingredients where organization_id = $1', [org])).toBe(50)
  })

  it('samtidige medlemstillegg kan ikke passere max_members', async () => {
    const owner = await db.signUp('mem-owner@example.com', { full_name: 'Eier', account_type: 'business', organization_name: 'Medlem AS' })
    const org = await orgOf(owner)
    await setPlan(org, 'plus') // maks 3 medlemmer
    const emails = ['m1@example.com', 'm2@example.com', 'm3@example.com', 'm4@example.com']
    for (const e of emails) await db.signUp(e, { full_name: e })
    const clients = await Promise.all(emails.map(() => db.connectAs(owner)))
    const results = await Promise.all(clients.map((c, i) => inTx(c, async (tx) => {
      await tx.query(`select public.add_member_by_email($1, $2)`, [org, emails[i]])
      await tx.query(HOLD)
    })))
    expect(results.filter((r) => r.ok)).toHaveLength(2)
    expect(await count('select count(*) n from public.organization_members where organization_id = $1', [org])).toBe(3)
  })

  it('redigering blokkeres ikke av samtidige innsettinger ved grensen', async () => {
    const u = await db.signUp('edit@example.com', { full_name: 'E' })
    const org = await orgOf(u)
    await setPlan(org, 'free')
    const c0 = await db.connectAs(u)
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push((await c0.query<{ id: string }>(`select public.save_recipe($1, $2, '[]') as id`, [org, { name: `R${i}`, yield_count: 1 }])).rows[0].id)
    const clients = await Promise.all(ids.map(() => db.connectAs(u)))
    const results = await Promise.all(clients.map((c, i) => inTx(c, async (tx) => {
      await tx.query(`select public.save_recipe($1, $2, '[]')`, [org, { id: ids[i], name: `Endret ${i}`, yield_count: 2 }])
      await tx.query(HOLD)
    })))
    expect(results.every((r) => r.ok)).toBe(true)
  })
})

describe('samtidig import', () => {
  it('to samtidige importer av samme data gir ingen duplikater', async () => {
    const u = await db.signUp('import@example.com', { full_name: 'Imp' })
    const org = await orgOf(u)
    const payload = {
      ingredients: Array.from({ length: 10 }, (_, i) => ({ local_id: `ing-${i}`, name: `Ing ${i}`, package_size: 1, unit: 'kg', price: 1 })),
      recipes: [{ local_id: 'rec-1', name: 'R', yield_count: 1, ingredients: [{ ingredient_local_id: 'ing-1', amount: 1, unit: 'kg' }] }],
    }
    const clients = await Promise.all([db.connectAs(u), db.connectAs(u), db.connectAs(u)])
    const results = await Promise.all(clients.map((c) => inTx(c, async (tx) => {
      const r = (await tx.query<{ r: Record<string, number> }>(`select public.import_local_data($1, $2) as r`, [org, payload])).rows[0].r
      await tx.query(HOLD)
      return r
    })))
    expect(results.every((r) => r.ok)).toBe(true)
    const inserted = results.reduce((s, r) => s + (r.ok ? r.value.ingredients_inserted : 0), 0)
    expect(inserted).toBe(10)
    expect(await count('select count(*) n from public.ingredients where organization_id = $1', [org])).toBe(10)
    expect(await count('select count(*) n from public.recipes where organization_id = $1', [org])).toBe(1)
    expect(await count('select count(*) n from public.recipe_ingredients where organization_id = $1', [org])).toBe(1)
  })
})

describe('eierskap ved samtidige medlemsendringer', () => {
  async function bizWithTwoOwners(prefix: string) {
    const a = await db.signUp(`${prefix}-a@example.com`, { full_name: 'A', account_type: 'business', organization_name: `${prefix} AS` })
    const b = await db.signUp(`${prefix}-b@example.com`, { full_name: 'B' })
    const m = await db.signUp(`${prefix}-m@example.com`, { full_name: 'M' })
    const org = await orgOf(a)
    const ca = await db.connectAs(a)
    await ca.query(`select public.add_member_by_email($1, $2, 'owner')`, [org, `${prefix}-b@example.com`])
    await ca.query(`select public.add_member_by_email($1, $2, 'member')`, [org, `${prefix}-m@example.com`])
    return { a, b, m, org }
  }
  const owners = async (org: string) => count(`select count(*) n from public.organization_members where organization_id = $1 and role = 'owner'`, [org])

  it('to eiere som degraderer hverandre samtidig: én lykkes, organisasjonen har fortsatt eier', async () => {
    const { a, b, org } = await bizWithTwoOwners('demote')
    const [ca, cb] = await Promise.all([db.connectAs(a), db.connectAs(b)])
    const results = await Promise.all([
      inTx(ca, async (tx) => { await tx.query(`select public.set_member_role($1, $2, 'member')`, [org, b]); await tx.query(HOLD) }),
      inTx(cb, async (tx) => { await tx.query(`select public.set_member_role($1, $2, 'member')`, [org, a]); await tx.query(HOLD) }),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(await owners(org)).toBe(1)
  })

  it('to eiere som forlater samtidig: én får LAST_OWNER', async () => {
    const { a, b, org } = await bizWithTwoOwners('leave')
    const [ca, cb] = await Promise.all([db.connectAs(a), db.connectAs(b)])
    const results = await Promise.all([
      inTx(ca, async (tx) => { await tx.query(`select public.leave_organization($1)`, [org]); await tx.query(HOLD) }),
      inTx(cb, async (tx) => { await tx.query(`select public.leave_organization($1)`, [org]); await tx.query(HOLD) }),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.some((r) => !r.ok && /LAST_OWNER/.test(r.error.message))).toBe(true)
    expect(await owners(org)).toBe(1)
  })

  it('to eiere som sletter kontoen samtidig: bedriften beholder data og får ny eier', async () => {
    const { a, b, m, org } = await bizWithTwoOwners('delete')
    await db.admin.query(`insert into public.ingredients (organization_id, name, package_size, unit, price) values ($1, 'Felles', 1, 'kg', 1)`, [org])
    const [ca, cb] = await Promise.all([db.connectAs(a), db.connectAs(b)])
    const results = await Promise.all([
      inTx(ca, async (tx) => { await tx.query(`select public.delete_my_account('SLETT')`); await tx.query(HOLD) }),
      inTx(cb, async (tx) => { await tx.query(`select public.delete_my_account('SLETT')`); await tx.query(HOLD) }),
    ])
    expect(results.every((r) => r.ok)).toBe(true)
    const rows = (await db.admin.query<{ user_id: string; role: string }>('select user_id, role from public.organization_members where organization_id = $1', [org])).rows
    expect(rows).toEqual([{ user_id: m, role: 'owner' }])
    expect(await count('select count(*) n from public.ingredients where organization_id = $1', [org])).toBe(1)
  })

  it('eier fjerner admin samtidig som admin legger til medlem – ingen inkonsistens', async () => {
    const owner = await db.signUp('race-owner@example.com', { full_name: 'O', account_type: 'business', organization_name: 'Race AS' })
    const adm = await db.signUp('race-admin@example.com', { full_name: 'A' })
    await db.signUp('race-new@example.com', { full_name: 'N' })
    const org = await orgOf(owner)
    const co = await db.connectAs(owner)
    await co.query(`select public.add_member_by_email($1, 'race-admin@example.com', 'admin')`, [org])
    const [c1, c2] = await Promise.all([db.connectAs(owner), db.connectAs(adm)])
    const results = await Promise.all([
      inTx(c1, async (tx) => { await tx.query(`select public.remove_member($1, $2)`, [org, adm]); await tx.query(HOLD) }),
      inTx(c2, async (tx) => { await tx.query(HOLD); await tx.query(`select public.add_member_by_email($1, 'race-new@example.com')`, [org]) }),
    ])
    expect(results[0].ok).toBe(true)
    // Admin ble fjernet først og har ikke lenger rett til å legge til medlemmer
    expect(!results[1].ok && /FORBIDDEN/.test(results[1].error.message)).toBe(true)
    expect(await owners(org)).toBe(1)
  })
})

describe('ingen deadlocks', () => {
  it('blandede samtidige operasjoner på overlappende organisasjoner gir ingen deadlock (40P01)', async () => {
    const owner1 = await db.signUp('dl-1@example.com', { full_name: '1', account_type: 'business', organization_name: 'DL1' })
    const owner2 = await db.signUp('dl-2@example.com', { full_name: '2', account_type: 'business', organization_name: 'DL2' })
    const shared = await db.signUp('dl-s@example.com', { full_name: 'S' })
    for (let i = 0; i < 6; i++) await db.signUp(`dl-x${i}@example.com`, { full_name: `x${i}` })
    const [org1, org2] = [await orgOf(owner1), await orgOf(owner2)]
    await (await db.connectAs(owner1)).query(`select public.add_member_by_email($1, 'dl-s@example.com', 'admin')`, [org1])
    await (await db.connectAs(owner2)).query(`select public.add_member_by_email($1, 'dl-s@example.com', 'admin')`, [org2])

    const ops: Array<() => Promise<{ ok: boolean; error?: { code?: string } }>> = []
    const tx = (c: pg.Client, sql: string, params: unknown[]) => inTx(c, async (t) => { await t.query(sql, params); await t.query('select pg_sleep(0.05)') })
    for (let i = 0; i < 3; i++) {
      ops.push(async () => tx(await db.connectAs(owner1), `select public.add_member_by_email($1, $2)`, [org1, `dl-x${i}@example.com`]))
      ops.push(async () => tx(await db.connectAs(owner2), `select public.add_member_by_email($1, $2)`, [org2, `dl-x${i + 3}@example.com`]))
      ops.push(async () => tx(await db.connectAs(shared), `select public.save_recipe($1, $2, '[]')`, [i % 2 ? org1 : org2, { name: `R${i}`, yield_count: 1 }]))
    }
    ops.push(async () => tx(await db.connectAs(shared), `select public.delete_my_account('SLETT')`, []))
    const results = await Promise.all(ops.map((f) => f()))
    const deadlocks = results.filter((r) => !r.ok && r.error?.code === '40P01')
    expect(deadlocks).toEqual([])
  })
})

describe('kontroll: testene oppdager kappløp', () => {
  it('uten advisory lock passerer samtidige transaksjoner grensen (viser at låsen er nødvendig)', async () => {
    const original = (await db.admin.query<{ def: string }>(`select pg_get_functiondef('public.lock_organization(uuid)'::regprocedure) as def`)).rows[0].def
    await db.admin.query(`create or replace function public.lock_organization(org uuid) returns void language sql set search_path = '' as 'select'`)
    try {
      const u = await db.signUp('kontroll@example.com', { full_name: 'K' })
      const org = await orgOf(u)
      await setPlan(org, 'free')
      const clients = await Promise.all(Array.from({ length: 8 }, () => db.connectAs(u)))
      await Promise.all(clients.map((c, i) => inTx(c, async (tx) => {
        await tx.query(`insert into public.recipes (organization_id, name, yield_count) values ($1, $2, 1)`, [org, `K${i}`])
        await tx.query(HOLD)
      })))
      expect(await count('select count(*) n from public.recipes where organization_id = $1', [org])).toBeGreaterThan(5)
    } finally {
      await db.admin.query(original)
    }
  })
})
