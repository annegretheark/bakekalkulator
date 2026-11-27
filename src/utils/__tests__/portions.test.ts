import { describe, expect, it } from 'vitest'
import { bakeTypeForCategory, categoryForBakeType, costPerKg, normalizeRecipe, scaledWeightG, weightPerUnitG } from '../portions'
import { equipmentFromRow, equipmentToRpc, recipeFromRow, recipeToRpc, settingsFromRows, type RecipeRow } from '../../services/storage/mappers'
import { equipmentFromTemplate } from '../../lib/equipmentTemplates'
import { BUSINESS_PROFILES, businessProfile, yieldWord } from '../../lib/businessTypes'
import { BUSINESS_TYPES, type Recipe } from '../../types'
import { SEED_RECIPES } from '../../lib/seed'

describe('porsjoner og kilopris', () => {
  const r = { finishedWeightG: 2000, yieldCount: 8 }

  it('skalerer ferdig vekt med antall', () => {
    expect(scaledWeightG(r, 16)).toBe(4000)
    expect(scaledWeightG({ finishedWeightG: null, yieldCount: 8 }, 8)).toBeNull()
  })

  it('beregner kostnad per kilo og vekt per porsjon', () => {
    expect(costPerKg(120, 2000)).toBe(60)
    expect(costPerKg(120, null)).toBeNull()
    expect(weightPerUnitG(r)).toBe(250)
  })

  it('kategori og bakeverketype henger sammen', () => {
    expect(categoryForBakeType('kake')).toBe('brod_bakervarer')
    expect(categoryForBakeType('pizza')).toBe('pizza')
    expect(bakeTypeForCategory('supper', 'brod')).toBe('annet')
    expect(bakeTypeForCategory('brod_bakervarer', 'boller')).toBe('boller')
    expect(bakeTypeForCategory('brod_bakervarer', 'annet')).toBe('brod')
  })

  it('normaliserer eldre lokale oppskrifter uten nye felt', () => {
    const old = { ...SEED_RECIPES[0] } as Partial<Recipe>
    delete old.category; delete old.yieldUnit; delete old.prepMinutes; delete old.finishedWeightG
    const n = normalizeRecipe(old as Recipe)
    expect(n).toMatchObject({ category: 'brod_bakervarer', yieldUnit: 'stk', prepMinutes: 0, finishedWeightG: null })
  })
})

describe('mappers for fase 1', () => {
  const row: RecipeRow = {
    id: 'r1', organization_id: 'o', name: 'Lasagne', type: 'annet', yield_count: 8, steps: [], rise_minutes: 0, bake_minutes: 45,
    store_price_per_item: 0, notes: '', energy: null, created_at: '', updated_at: '',
    category: 'hovedretter', yield_unit: 'porsjoner', prep_minutes: 30, finished_weight_g: '2400.00',
  }

  it('leser nye oppskriftsfelt og sender dem tilbake', () => {
    const r = recipeFromRow(row)
    expect(r).toMatchObject({ category: 'hovedretter', yieldUnit: 'porsjoner', prepMinutes: 30, finishedWeightG: 2400 })
    expect(recipeToRpc(r).recipe).toMatchObject({ category: 'hovedretter', yield_unit: 'porsjoner', prep_minutes: 30, finished_weight_g: 2400 })
  })

  it('tåler rader fra før migrasjonen (ingen nye kolonner)', () => {
    const r = recipeFromRow({ ...row, type: 'kake', category: undefined, yield_unit: undefined, prep_minutes: undefined, finished_weight_g: undefined })
    expect(r).toMatchObject({ category: 'brod_bakervarer', yieldUnit: 'stk', prepMinutes: 0, finishedWeightG: null })
  })

  it('utstyr går tur-retur gjennom RPC-formatet', () => {
    const e = { ...equipmentFromTemplate('pizzaovn', 'e1'), manufacturer: 'Ooni', measuredKwh: 3.5, outputPerRun: 4 }
    const rpc = equipmentToRpc(e)
    expect(rpc).toMatchObject({ equipment_type: 'pizzaovn', manufacturer: 'Ooni', measured_kwh: 3.5, output_per_run: 4, is_estimate: true })
    const back = equipmentFromRow({ ...rpc, organization_id: 'o', watt: String(rpc.watt) })
    expect(back).toMatchObject({ type: 'pizzaovn', manufacturer: 'Ooni', measuredKwh: 3.5, outputPerRun: 4, watt: e.watt, isEstimate: true })
  })

  it('ukjent utstyrstype blir «annet», og verdier holdes innenfor databasens grenser', () => {
    expect(equipmentFromRow({ id: 'x', organization_id: 'o', name: 'X', equipment_type: 'rakett', watt: 1, minutes: 0, power_factor_percent: 100 }).type).toBe('annet')
    const rpc = equipmentToRpc({ ...equipmentFromTemplate('annet', 'x'), watt: 500000, powerPercent: 150, hoursPerDay: 30 })
    expect(rpc).toMatchObject({ watt: 100000, power_factor_percent: 100, hours_per_day: 24 })
  })

  it('virksomhetstype leses fra organisasjonen, ukjent verdi gir standard', () => {
    expect(settingsFromRows(null, null, 'pro', 'restaurant').businessType).toBe('restaurant')
    expect(settingsFromRows(null, null, 'pro', 'tull').businessType).toBe('privat')
    expect(settingsFromRows(null, null, 'pro', null).businessType).toBe('privat')
  })
})

describe('virksomhetsprofiler', () => {
  it('alle virksomhetstyper har profil', () => {
    for (const b of BUSINESS_TYPES) expect(BUSINESS_PROFILES[b].calculatorName).toBeTruthy()
  })

  it('restaurant bruker porsjoner og produksjonsord, bakeri beholder bakeord', () => {
    expect(businessProfile('restaurant')).toMatchObject({ defaultYieldUnit: 'porsjoner', historyName: 'Produksjonshistorikk', showStorePrice: false })
    expect(businessProfile('bakeri')).toMatchObject({ defaultYieldUnit: 'stk', calculatorName: 'Bakekalkulator', showStorePrice: true })
    expect(businessProfile(undefined).calculatorName).toBe('Bakekalkulator')
  })

  it('enhetsord', () => {
    expect(yieldWord('porsjoner', 1)).toBe('porsjon')
    expect(yieldWord('porsjoner', 4)).toBe('porsjoner')
    expect(yieldWord('stk', 1)).toBe('stk')
  })
})
