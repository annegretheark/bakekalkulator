import { describe, expect, it } from 'vitest'
import type { EnergyInput, Ingredient, PriceSettings, Recipe } from '../../types'
import { calculateEnergy, energyKwh, ovenLoadProfile } from '../energy'
import { calculatePrice, findCheapestWindow, profileCost } from '../electricity'
import { batchComparison, calculateSavings, costPerItem, ingredientCost, recipeCostLines, scaleRecipeIngredients, sumCosts } from '../costs'
import { convert, isCompatible } from '../units'
import { calculateSales, markup, priceForMargin, profitMargin } from '../sales'
import { summarize } from '../stats'

const energyInput = (o: Partial<EnergyInput> = {}): EnergyInput => ({
  ovenWatt: 3000, temperatureC: 230, preheatMinutes: 15, preheatPowerPercent: 100,
  bakeMinutes: 40, bakePowerPercent: 50, rounds: 1,
  mixerWatt: 1000, mixerMinutes: 10, mixerPowerPercent: 60,
  otherEquipment: [], useMeasured: false, measuredKwh: 0, ...o,
})

const priceSettings = (o: Partial<PriceSettings> = {}): PriceSettings => ({
  area: 'NO1', customerType: 'privat', mode: 'spot', vatRatePercent: 25, vatDeductible: false,
  norgespris: { enabled: true, krPerKwh: 0.4, includesVat: false },
  fixedPrice: { enabled: true, krPerKwh: 1.0, includesVat: false },
  manualTotalKrPerKwh: 2,
  supplierMarkup: { enabled: false, krPerKwh: 0, includesVat: false },
  gridFee: { enabled: false, krPerKwh: 0, includesVat: false },
  electricityTax: { enabled: false, krPerKwh: 0, includesVat: false, includedInGridFee: false },
  otherFees: { enabled: false, krPerKwh: 0, includesVat: false },
  subsidy: { enabled: false, thresholdKrPerKwhExVat: 0.75, coveragePercent: 90 },
  officialRates: 'manual',
  ...o,
})

describe('strømforbruk', () => {
  it('kWh = W/1000 × timer × effektfaktor', () => {
    expect(energyKwh(3000, 60, 100)).toBeCloseTo(3)
    expect(energyKwh(3000, 40, 50)).toBeCloseTo(1)
    expect(energyKwh(-100, 60)).toBe(0)
  })

  it('beregner forvarming én gang og steking per omgang', () => {
    const r = calculateEnergy(energyInput({ rounds: 2 }))
    const part = (k: string) => r.parts.find((p) => p.key === k)!.kwh
    expect(part('preheat')).toBeCloseTo(0.75)
    expect(part('bake')).toBeCloseTo(2) // 1 kWh × 2 omganger
    expect(part('mixer')).toBeCloseTo(0.1)
    expect(r.totalKwh).toBeCloseTo(2.85)
  })

  it('inkluderer annet utstyr', () => {
    const r = calculateEnergy(energyInput({ otherEquipment: [{ id: 'x', name: 'Hevebox', watt: 200, minutes: 60, powerFactorPercent: 50 }] }))
    expect(r.parts.find((p) => p.key === 'other')!.kwh).toBeCloseTo(0.1)
  })

  it('bruker målt forbruk når det er valgt', () => {
    const r = calculateEnergy(energyInput({ useMeasured: true, measuredKwh: 1.9 }))
    expect(r.totalKwh).toBe(1.9)
    expect(r.measured).toBe(true)
    expect(r.estimatedKwh).toBeCloseTo(1.85)
  })

  it('lager ovnsprofil uten å gjenta forvarming', () => {
    const p = ovenLoadProfile(energyInput({ rounds: 3 }))
    expect(p).toEqual([{ minutes: 15, kw: 3 }, { minutes: 120, kw: 1.5 }])
  })
})

describe('strømkostnader', () => {
  it('spotpris legger på mva én gang', () => {
    const b = calculatePrice(priceSettings(), 1)
    expect(b.vat).toBeCloseTo(0.25)
    expect(b.total).toBeCloseTo(1.25)
  })

  it('unngår dobbel mva når tillegg er oppgitt inkl. mva', () => {
    const b = calculatePrice(priceSettings({ gridFee: { enabled: true, krPerKwh: 0.5, includesVat: true } }), 1)
    expect(b.gridFee).toBeCloseTo(0.4)
    expect(b.total).toBeCloseTo(1.25 + 0.5)
  })

  it('legger ikke til elavgift når den er inkludert i nettleien', () => {
    const s = priceSettings({
      gridFee: { enabled: true, krPerKwh: 0.4, includesVat: false },
      electricityTax: { enabled: true, krPerKwh: 0.1, includesVat: false, includedInGridFee: true },
    })
    expect(calculatePrice(s, 1).electricityTax).toBe(0)
    expect(calculatePrice(s, 1).total).toBeCloseTo(1.4 * 1.25)
  })

  it('beregner strømstøtte over terskel inkl. mva', () => {
    const b = calculatePrice(priceSettings({ subsidy: { enabled: true, thresholdKrPerKwhExVat: 1, coveragePercent: 90 } }), 2)
    expect(b.subsidy).toBeCloseTo(-(1 * 0.9 * 1.25))
    expect(b.total).toBeCloseTo(2.5 - 1.125)
  })

  it('manuell pris brukes uten tillegg', () => {
    const b = calculatePrice(priceSettings({ mode: 'manuell', manualTotalKrPerKwh: 1.8, gridFee: { enabled: true, krPerKwh: 1, includesVat: false } }), 5)
    expect(b.total).toBe(1.8)
  })

  it('norgespris ignorerer spot, påslag og strømstøtte', () => {
    const b = calculatePrice(priceSettings({
      mode: 'norgespris',
      supplierMarkup: { enabled: true, krPerKwh: 0.1, includesVat: false },
      subsidy: { enabled: true, thresholdKrPerKwhExVat: 0, coveragePercent: 90 },
    }), 3)
    expect(b.total).toBeCloseTo(0.5)
  })

  it('bedrift: Norgespris faller tilbake til spot', () => {
    const b = calculatePrice(priceSettings({ customerType: 'bedrift', mode: 'norgespris' }), 2)
    expect(b.total).toBeCloseTo(2.5)
    expect(b.notes.join(' ')).toMatch(/Norgespris gjelder ikke bedrifter/)
  })

  it('bedrift: ingen strømstøtte selv om den er slått på', () => {
    const b = calculatePrice(priceSettings({ customerType: 'bedrift', subsidy: { enabled: true, thresholdKrPerKwhExVat: 0.5, coveragePercent: 90 } }), 2)
    expect(b.subsidy).toBe(0)
    expect(b.total).toBeCloseTo(2.5)
  })

  it('mva-registrert bedrift: ingen mva, og mva trekkes ut av satser oppgitt inkl. mva', () => {
    const b = calculatePrice(priceSettings({
      customerType: 'bedrift', vatDeductible: true,
      gridFee: { enabled: true, krPerKwh: 0.5, includesVat: true },
    }), 1)
    expect(b.vat).toBe(0)
    expect(b.total).toBeCloseTo(1 + 0.4)
  })

  it('privat og bedrift gir ulik pris med standardoppsett', () => {
    const privat = calculatePrice(priceSettings({ subsidy: { enabled: true, thresholdKrPerKwhExVat: 0.77, coveragePercent: 90 } }), 2)
    const bedrift = calculatePrice(priceSettings({ customerType: 'bedrift', vatDeductible: true }), 2)
    expect(privat.total).toBeCloseTo(2.5 - (2 - 0.77) * 0.9 * 1.25)
    expect(bedrift.total).toBeCloseTo(2)
    expect(privat.total).not.toBeCloseTo(bedrift.total)
  })

  it('mva-sats 0 (f.eks. Nord-Norge)', () => {
    expect(calculatePrice(priceSettings({ vatRatePercent: 0 }), 1).total).toBe(1)
  })
})

describe('enhetskonvertering', () => {
  it('konverterer innen samme dimensjon', () => {
    expect(convert(750, 'g', 'kg')).toBeCloseTo(0.75)
    expect(convert(2, 'l', 'dl')).toBe(20)
    expect(convert(5, 'dl', 'ml')).toBe(500)
  })
  it('nekter volum ↔ vekt uten tetthet', () => {
    expect(convert(1, 'dl', 'g')).toBeNull()
    expect(convert(1, 'stk', 'kg')).toBeNull()
    expect(isCompatible('l', 'ml')).toBe(true)
  })
})

const mel: Ingredient = { id: 'mel', name: 'Hvetemel', category: 'Mel', packageSize: 2, unit: 'kg', price: 32, store: 'X', priceUpdated: '2026-01-01' }

describe('ingredienskostnader', () => {
  it('2 kg mel til 32 kr, 750 g brukt = 12 kr', () => {
    expect(ingredientCost(mel, 750, 'g')).toBeCloseTo(12)
  })
  it('returnerer null ved inkompatibel enhet', () => {
    expect(ingredientCost(mel, 3, 'dl')).toBeNull()
  })
})

const recipe: Recipe = {
  id: 'r', name: 'Test', type: 'brod', category: 'brod_bakervarer', yieldCount: 3, yieldUnit: 'stk', prepMinutes: 0, finishedWeightG: null, steps: [], riseMinutes: 0, bakeMinutes: 0,
  storePricePerItem: 40, notes: '', energy: energyInput(), createdAt: '', updatedAt: '',
  ingredients: [{ id: 'a', ingredientId: 'mel', amount: 1500, unit: 'g' }],
}

describe('skalering av oppskrifter', () => {
  it('skalerer mengder etter antall', () => {
    expect(scaleRecipeIngredients(recipe.ingredients, 3, 6)[0].amount).toBe(3000)
    expect(scaleRecipeIngredients(recipe.ingredients, 3, 1)[0].amount).toBe(500)
  })
  it('kostnaden følger skaleringen', () => {
    expect(sumCosts(recipeCostLines(recipe, [mel]))).toBeCloseTo(24)
    expect(sumCosts(recipeCostLines(recipe, [mel], 6))).toBeCloseTo(48)
  })
  it('markerer ukjente ingredienser', () => {
    expect(recipeCostLines(recipe, [])[0].cost).toBeNull()
  })
})

describe('kostnad per bakervare og besparelse', () => {
  it('deler total på antall', () => {
    expect(costPerItem(30, 3)).toBe(10)
    expect(costPerItem(30, 0)).toBeNull()
  })
  it('beregner besparelse per måned og år', () => {
    const s = calculateSavings(40, 10, 3, 4)
    expect(s.perBake).toBe(90)
    expect(s.perMonth).toBe(360)
    expect(s.perYear).toBe(4320)
  })
  it('flere brød i samme ovn gir lavere kostnad per stk', () => {
    const rows = batchComparison(3, 6, 0.3, 24)
    expect(rows[1].costPerItem).toBeLessThan(rows[0].costPerItem)
    expect(rows[1].electricityCost).toBeCloseTo(6.6)
  })
})

describe('fortjeneste, margin og påslag', () => {
  it('skiller margin og påslag', () => {
    expect(profitMargin(100, 75)).toBeCloseTo(25)
    expect(markup(100, 75)).toBeCloseTo(33.333, 2)
  })
  it('anbefalt pris for ønsket margin', () => {
    expect(priceForMargin(60, 40)).toBeCloseTo(100)
    expect(priceForMargin(60, 100)).toBeNull()
  })
  it('full salgskalkyle med mva og svinn', () => {
    const r = calculateSales({
      units: 10, ingredientCost: 100, electricityCost: 20, packagingPerUnit: 2, laborHours: 1, hourlyRate: 200,
      transport: 30, wastePercent: 10, otherCosts: 10, pricePerUnit: 100, priceIncludesVat: true, vatRatePercent: 25,
      targetMarginPercent: 30,
    })
    expect(r.totalCost).toBe(380)
    expect(r.soldUnits).toBe(9)
    expect(r.priceExVat).toBe(80)
    expect(r.revenueExVat).toBe(720)
    expect(r.profit).toBe(340)
    expect(r.marginPercent).toBeCloseTo(47.22, 1)
    expect(r.markupPercent).toBeCloseTo(89.47, 1)
    expect(r.recommendedPriceExVat).toBeCloseTo(380 / 9 / 0.7)
  })
})

describe('billigste tidspunkt', () => {
  const hourly = [3, 2, 1, 1, 4, 5].map((p, i) => ({
    start: new Date(Date.UTC(2026, 0, 1, i)).toISOString(),
    end: new Date(Date.UTC(2026, 0, 1, i + 1)).toISOString(),
    totalPerKwh: p,
  }))

  it('finner billigste sammenhengende vindu med timespriser', () => {
    const w = findCheapestWindow(hourly, [{ minutes: 120, kw: 1 }])!
    expect(w.start).toBe(hourly[2].start)
    expect(w.cost).toBeCloseTo(2)
  })

  it('tar hensyn til at forvarming bruker mer effekt', () => {
    // 1 t forvarming 3 kW + 1 t steking 1 kW
    const w = findCheapestWindow(hourly, [{ minutes: 60, kw: 3 }, { minutes: 60, kw: 1 }])!
    expect(w.start).toBe(hourly[2].start) // 3·1 + 1·1 = 4
    expect(w.cost).toBeCloseTo(4)
  })

  it('støtter kvarterspriser og delvise intervaller', () => {
    const q = [4, 4, 1, 1, 1, 4].map((p, i) => ({
      start: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(),
      end: new Date(Date.UTC(2026, 0, 1, 0, (i + 1) * 15)).toISOString(),
      totalPerKwh: p,
    }))
    const w = findCheapestWindow(q, [{ minutes: 40, kw: 1.5 }])!
    expect(w.start).toBe(q[2].start)
    expect(profileCost(q, [{ minutes: 40, kw: 1.5 }], Date.parse(q[2].start))).toBeCloseTo(1.5 * (40 / 60) * 1)
  })

  it('returnerer null når prosessen er lengre enn tilgjengelige priser', () => {
    expect(findCheapestWindow(hourly, [{ minutes: 60 * 7, kw: 1 }])).toBeNull()
  })

  it('respekterer tidligste starttid', () => {
    const w = findCheapestWindow(hourly, [{ minutes: 60, kw: 1 }], new Date(hourly[4].start))!
    expect(w.start).toBe(hourly[4].start)
  })
})

describe('historikkstatistikk', () => {
  it('summerer og beregner snitt', () => {
    const base = { recipeId: null, recipeName: 'x', type: 'brod' as const, kwh: 2, pricePerKwh: 1, electricityCost: 2, ingredientCost: 28, note: '' }
    const s = summarize([
      { ...base, id: '1', date: '2026-01-01', count: 3, totalCost: 30, costPerItem: 10, storePricePerItem: 40, revenue: null, profit: null },
      { ...base, id: '2', date: '2026-01-02', count: 2, totalCost: 20, costPerItem: 10, storePricePerItem: 0, revenue: 100, profit: 80 },
    ])
    expect(s.items).toBe(5)
    expect(s.avgCostPerItem).toBe(10)
    expect(s.savings).toBe(90)
    expect(s.profit).toBe(80)
  })
})
