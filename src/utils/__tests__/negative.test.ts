// Negative strømpriser: norske spotpriser kan være under null.
import { describe, expect, it } from 'vitest'
import type { PriceSettings } from '../../types'
import { defaultEnergyInput, defaultPriceSettings } from '../../lib/defaults'
import { calculatePrice, findCheapestWindow } from '../electricity'
import { computeBake } from '../bake'
import { calculateSales } from '../sales'
import { dbErrorMessage, historyFromRow, historyToRow } from '../../services/storage/mappers'
import { seedData } from '../../lib/seed'

const spot = (o: Partial<PriceSettings> = {}): PriceSettings => ({
  ...defaultPriceSettings('NO1'), customerType: 'privat', mode: 'spot', vatRatePercent: 25, officialRates: 'manual',
  subsidy: { enabled: false, thresholdKrPerKwhExVat: 0.77, coveragePercent: 90 }, ...o,
})

describe('negative strømpriser', () => {
  it('negativ spotpris gir negativ totalpris (inkl. mva)', () => {
    expect(calculatePrice(spot(), -0.2).total).toBeCloseTo(-0.25)
  })

  it('tillegg kan løfte totalprisen over null', () => {
    const b = calculatePrice(spot({ gridFee: { enabled: true, krPerKwh: 0.5, includesVat: true } }), -0.2)
    expect(b.total).toBeCloseTo((-0.2 + 0.4) * 1.25)
  })

  it('strømstøtte gis ikke ved negativ spotpris', () => {
    const b = calculatePrice(spot({ subsidy: { enabled: true, thresholdKrPerKwhExVat: 0.77, coveragePercent: 90 } }), -0.5)
    expect(b.subsidy).toBe(0)
    expect(b.total).toBeCloseTo(-0.625)
  })

  it('mva-registrert bedrift får negativ pris eks. mva', () => {
    expect(calculatePrice(spot({ customerType: 'bedrift', vatDeductible: true }), -0.3).total).toBeCloseTo(-0.3)
  })

  it('manuell totalpris kan være negativ', () => {
    expect(calculatePrice(spot({ mode: 'manuell', manualTotalKrPerKwh: -0.1 }), 1).total).toBe(-0.1)
  })

  it('negativ strømkostnad og negativ total bakekostnad', () => {
    const r = computeBake({ energy: defaultEnergyInput(), count: 3, recipe: null, ingredients: [], pricePerKwh: -0.5, storePricePerItem: 0, bakesPerMonth: 4 })
    expect(r.electricityCost).toBeLessThan(0)
    expect(r.totalCost).toBeCloseTo(r.electricityCost)
    expect(r.costPerItem!).toBeLessThan(0)
    expect(r.partCosts.every((p) => p.cost <= 0)).toBe(true)
  })

  it('ingredienser trekkes ikke ned av negativ strømpris', () => {
    const d = seedData()
    const r = computeBake({ energy: defaultEnergyInput(), count: 3, recipe: d.recipes[0], ingredients: d.ingredients, pricePerKwh: -0.5, storePricePerItem: 45, bakesPerMonth: 4 })
    expect(r.ingredientCost).toBeGreaterThan(0)
    expect(r.totalCost).toBeCloseTo(r.ingredientCost + r.electricityCost)
  })

  it('billigste tidspunkt velger negative priser', () => {
    const iv = [0.5, -0.3, -0.4, 0.2].map((p, i) => ({
      start: new Date(Date.UTC(2026, 0, 1, i)).toISOString(), end: new Date(Date.UTC(2026, 0, 1, i + 1)).toISOString(), totalPerKwh: p,
    }))
    const w = findCheapestWindow(iv, [{ minutes: 120, kw: 1 }])!
    expect(w.start).toBe(iv[1].start)
    expect(w.cost).toBeCloseTo(-0.7)
    expect(w.avgPricePerKwh).toBeCloseTo(-0.35)
  })

  it('salgskalkyle håndterer negativ strømkostnad', () => {
    const r = calculateSales({ units: 10, ingredientCost: 100, electricityCost: -5, packagingPerUnit: 0, laborHours: 0, hourlyRate: 0, transport: 0, wastePercent: 0, otherCosts: 0, pricePerUnit: 20, priceIncludesVat: false, vatRatePercent: 0, targetMarginPercent: 30 })
    expect(r.totalCost).toBe(95)
  })

  it('historikk lagrer negative strømverdier uendret, men kWh og ingredienser ikke under null', () => {
    const log = { ...seedData().history[0], pricePerKwh: -0.123456, electricityCost: -0.5, ingredientCost: 0, totalCost: -0.5, costPerItem: -0.1667, kwh: -1 }
    const row = historyToRow(log, 'org')
    expect(row.price_per_kwh).toBe(-0.123456)
    expect(row.electricity_cost).toBe(-0.5)
    expect(row.total_cost).toBe(-0.5)
    expect(row.cost_per_item).toBe(-0.1667)
    expect(row.kwh).toBe(0)
    const back = historyFromRow({ ...row, total_cost: '-0.50', electricity_cost: '-0.50', price_per_kwh: '-0.123456', revenue: null, profit: null })
    expect(back.totalCost).toBe(-0.5)
    expect(back.pricePerKwh).toBe(-0.123456)
  })

  it('overlappende sats gir lesbar feilmelding', () => {
    expect(dbErrorMessage({ code: '23P01', message: 'conflicting key value violates exclusion constraint "electricity_tariffs_no_overlap"' })).toMatch(/overlapper/)
  })
})
