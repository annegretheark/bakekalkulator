import { describe, expect, it } from 'vitest'
import { LocalStorageRepository } from '../storage/localStorageRepository'
import { parsePriceRows, priceUrl } from '../priceApi'

class MemoryStorage implements Storage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  getItem(k: string) { return this.m.get(k) ?? null }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  removeItem(k: string) { this.m.delete(k) }
  setItem(k: string, v: string) { this.m.set(k, v) }
}

describe('strømpris-API', () => {
  it('bygger riktig URL', () => {
    expect(priceUrl('2026-11-26', 'NO5')).toBe('https://www.hvakosterstrommen.no/api/v1/prices/2026/11-26_NO5.json')
  })
  it('tolker rader og filtrerer ugyldige', () => {
    const rows = parsePriceRows([
      { NOK_per_kWh: 1.2, EUR_per_kWh: 0.1, EXR: 11, time_start: '2026-11-26T00:00:00+01:00', time_end: '2026-11-26T00:15:00+01:00' },
      { NOK_per_kWh: 'x', time_start: 'a', time_end: 'b' },
    ])
    expect(rows).toEqual([{ start: '2026-11-26T00:00:00+01:00', end: '2026-11-26T00:15:00+01:00', spotNokPerKwh: 1.2 }])
  })
  it('avviser svar som ikke er en liste', () => {
    expect(() => parsePriceRows({ error: true })).toThrow()
  })
})

describe('lokal lagring', () => {
  it('legger inn eksempeldata med tre grovbrød første gang', async () => {
    const repo = new LocalStorageRepository(new MemoryStorage())
    const d = await repo.load()
    expect(d.recipes[0].yieldCount).toBe(3)
    expect(d.ingredients.length).toBeGreaterThan(5)
  })

  it('historikk endres ikke når ingrensprisene oppdateres', async () => {
    const repo = new LocalStorageRepository(new MemoryStorage())
    const d = await repo.load()
    const before = d.history[0]
    await repo.upsertIngredient({ ...d.ingredients[0], price: d.ingredients[0].price * 10 })
    const after = (await repo.load()).history.find((h) => h.id === before.id)!
    expect(after.ingredientCost).toBe(before.ingredientCost)
    expect(after.totalCost).toBe(before.totalCost)
  })

  it('tåler ødelagte data', async () => {
    const s = new MemoryStorage()
    s.setItem('rettilomma.bakekalkulator.v1', '{ikke json')
    const d = await new LocalStorageRepository(s).load()
    expect(Array.isArray(d.recipes)).toBe(true)
  })
})
