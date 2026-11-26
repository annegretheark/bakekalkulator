import { describe, expect, it, vi } from 'vitest'
import { buildImportPayload, hasImportableData, importLocalData } from '../importLocal'
import { dbErrorMessage, historyFromRow, historyToRow, ingredientFromRow, priceSettingsFromJson, recipeFromRow, recipeToRpc, settingsFromRows } from '../storage/mappers'
import { seedData } from '../../lib/seed'
import { effectivePlan, trialDaysLeft, type SubscriptionInfo } from '../../lib/plans'
import { LocalStorageRepository } from '../storage/localStorageRepository'

describe('prøveperioder (samme regel som i databasen)', () => {
  const now = new Date('2026-11-26T12:00:00Z')
  const trial = (endsInDays: number): SubscriptionInfo => ({
    plan: 'pro', status: 'trialing', trial_started_at: '2026-11-01T00:00:00Z',
    trial_ends_at: new Date(now.getTime() + endsInDays * 86_400_000).toISOString(), current_period_end: null,
  })

  it('aktiv prøve gir Pro', () => {
    expect(effectivePlan(trial(5), now)).toBe('pro')
    expect(trialDaysLeft(trial(5), now)).toBe(5)
  })
  it('utløpt prøve gir Free', () => {
    expect(effectivePlan(trial(-1), now)).toBe('free')
    expect(trialDaysLeft(trial(-1), now)).toBe(0)
  })
  it('aktivt betalt abonnement gir planen, utløpt periode gir Free', () => {
    expect(effectivePlan({ plan: 'plus', status: 'active', trial_started_at: null, trial_ends_at: null, current_period_end: null }, now)).toBe('plus')
    expect(effectivePlan({ plan: 'plus', status: 'active', trial_started_at: null, trial_ends_at: null, current_period_end: '2026-11-01T00:00:00Z' }, now)).toBe('free')
    expect(effectivePlan({ plan: 'pro', status: 'past_due', trial_started_at: null, trial_ends_at: null, current_period_end: null }, now)).toBe('free')
    expect(effectivePlan(null, now)).toBe('free')
  })
})

describe('import av lokale data', () => {
  it('bygger nyttelast med lokale id-er og koblinger', () => {
    const p = buildImportPayload(seedData())
    expect(p.ingredients.length).toBe(10)
    expect(p.ingredients[0].local_id).toBe('ing-hvetemel')
    expect(p.recipes[0].local_id).toBe('rec-grovbrod')
    expect(p.recipes[0].ingredients.every((l) => l.ingredient_local_id)).toBe(true)
  })

  it('samme data gir identisk nyttelast (grunnlag for duplikatkontroll)', () => {
    expect(buildImportPayload(seedData())).toEqual(buildImportPayload(seedData()))
  })

  it('ugyldige linjer filtreres, og ukjente ingrediensreferanser blir null', () => {
    const d = seedData()
    d.ingredients.push({ ...d.ingredients[0], id: 'tom', name: ' ' })
    d.recipes[0].ingredients.push({ id: 'x', ingredientId: 'finnes-ikke', amount: 1, unit: 'g' })
    const p = buildImportPayload(d)
    expect(p.ingredients.find((i) => i.local_id === 'tom')).toBeUndefined()
    expect(p.recipes[0].ingredients.at(-1)!.ingredient_local_id).toBeNull()
  })

  it('kaller import-RPC og gir lesbar feil ved plangrense', async () => {
    const ok = { rpc: vi.fn(async () => ({ data: { ingredients_inserted: 10, ingredients_skipped: 0, recipes_inserted: 1, recipes_skipped: 0 }, error: null })) }
    const r = await importLocalData(ok, 'org-1', seedData())
    expect(r.recipes_inserted).toBe(1)
    expect(ok.rpc).toHaveBeenCalledWith('import_local_data', expect.objectContaining({ org: 'org-1' }))
    const limited = { rpc: vi.fn(async () => ({ data: null, error: { message: 'PLAN_LIMIT: Free-planen tillater maks 5 oppskrifter.' } })) }
    await expect(importLocalData(limited, 'org-1', seedData())).rejects.toThrow('Free-planen tillater maks 5 oppskrifter.')
  })

  it('lokale data beholdes til brukeren selv sletter dem', async () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear(), key: () => null, length: 0 } as Storage
    const repo = new LocalStorageRepository(storage)
    expect(repo.peek()).toBeNull() // peek legger ikke inn eksempeldata
    await repo.load()
    expect(hasImportableData(repo.peek())).toBe(true)
    repo.clear()
    expect(repo.peek()).toBeNull()
  })
})

describe('mapping mellom database og app', () => {
  it('ingrediens og oppskrift', () => {
    const ing = ingredientFromRow({ id: 'i1', organization_id: 'o', name: 'Mel', category: 'Mel', package_size: '2.0000', unit: 'kg', price: '32.00', store: '', price_updated: '2026-11-01' })
    expect(ing).toMatchObject({ packageSize: 2, price: 32 })
    const rec = recipeFromRow({
      id: 'r1', organization_id: 'o', name: 'Brød', type: 'brod', yield_count: 3, steps: null, rise_minutes: 60, bake_minutes: 45,
      store_price_per_item: '45', notes: '', energy: { ovenWatt: 3000 }, created_at: '', updated_at: '',
      recipe_ingredients: [{ id: 'b', ingredient_id: null, position: 1, amount: '30', unit: 'g' }, { id: 'a', ingredient_id: 'i1', position: 0, amount: '750', unit: 'g' }],
    })
    expect(rec.ingredients.map((l) => l.id)).toEqual(['a', 'b'])
    expect(rec.ingredients[1].ingredientId).toBe('')
    expect(rec.energy.ovenWatt).toBe(3000)
    expect(rec.energy.rounds).toBe(1) // standardverdier fylles inn
    expect(recipeToRpc(rec).lines[1].ingredient_id).toBeNull()
  })

  it('historikk lagres som øyeblikksbilde med avrunding og leses likt tilbake', () => {
    const log = seedData().history[0]
    const row = historyToRow({ ...log, electricityCost: 2.56789 }, 'org', { ingredients: [{ name: 'Mel', cost: 20 }] })
    expect(row.electricity_cost).toBe(2.57)
    expect(row.snapshot).toEqual({ ingredients: [{ name: 'Mel', cost: 20 }] })
    const back = historyFromRow({ ...row, total_cost: String(row.total_cost), revenue: null, profit: null, type: row.type })
    expect(back.totalCost).toBe(Math.round(log.totalCost * 100) / 100) // lagret med 2 desimaler
    expect(back.revenue).toBeNull()
  })

  it('innstillinger flettes med standardverdier', () => {
    const s = settingsFromRows({ locale: 'nb-NO', currency: 'NOK', bakes_per_month: '8' }, { customerType: 'bedrift' }, 'pro')
    expect(s.bakesPerMonth).toBe(8)
    expect(s.price.customerType).toBe('bedrift')
    expect(s.price.officialRates).toBe('auto')
    expect(priceSettingsFromJson(null).area).toBe('NO1')
  })

  it('databasefeil blir lesbare', () => {
    expect(dbErrorMessage({ message: 'PLAN_FEATURE: Registrering av salg og fortjeneste krever Plus eller Pro.' })).toMatch(/krever Plus/)
    expect(dbErrorMessage({ message: 'new row violates row-level security policy', code: '42501' })).toMatch(/ikke tilgang/)
    expect(dbErrorMessage({ message: 'FORBIDDEN' })).toBe('Du har ikke tilgang til dette.')
  })
})
