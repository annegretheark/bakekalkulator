import { describe, expect, it } from 'vitest'
import type { Ingredient, PriceEntry, Recipe, Supplier, WasteLog } from '../../types'
import { defaultCostSettings, defaultEnergyInput, ingredientExtras } from '../../lib/defaults'
import { PLAN_FEATURES, PLAN_NAMES, canUse } from '../../lib/plans'
import {
  compareSuppliers, consumption, consumptionMovements, monthlyTotals, priceChangeEntry, priceChangeSince, pricePerBaseUnit,
  stockOverview, unitCostOf, wasteSummary,
} from '../inventory'
import { recipeCost, type RecipeCostContext } from '../recipeCost'
import { menuItemCalc } from '../menu'
import { ingredientFromRow, ingredientToRpc, priceFromRow, recipeFromRow, recipeToRpc, stockLevelsFrom, wasteFromRow, type RecipeRow } from '../../services/storage/mappers'
import { normalizeIngredient, normalizeRecipe } from '../portions'

const ing = (id: string, p: Partial<Ingredient> = {}): Ingredient => ({
  id, name: id, category: '', packageSize: 1, unit: 'kg', price: 100, store: '', priceUpdated: '2026-11-01',
  allergens: {}, allergensChecked: true, ...ingredientExtras(), ...p,
})
const noEnergy = () => ({ ...defaultEnergyInput(), ovenWatt: 0, mixerWatt: 0, preheatMinutes: 0, bakeMinutes: 0 })
const rec = (id: string, p: Partial<Recipe> = {}): Recipe => ({
  id, name: id, type: 'annet', category: 'annet', yieldCount: 1, yieldUnit: 'porsjoner', prepMinutes: 0, finishedWeightG: null,
  ingredients: [], labor: [], packagingPerUnit: 0, crossContact: [], wastePercent: 0, steps: [], riseMinutes: 0, bakeMinutes: 0,
  storePricePerItem: 0, notes: '', energy: noEnergy(), createdAt: '', updatedAt: '', ...p,
})
const ctx = (recipes: Recipe[], ingredients: Ingredient[]): RecipeCostContext => ({ recipes, ingredients, equipment: [], costs: defaultCostSettings(), pricePerKwh: 0 })

describe('Business-planer', () => {
  it('grenser og funksjoner', () => {
    expect(PLAN_FEATURES.business).toMatchObject({ maxMembers: 50, aiScans: 500, inventory: true, advancedDashboard: false })
    expect(PLAN_FEATURES.business_plus).toMatchObject({ maxMembers: 200, aiScans: 1000, inventory: true, advancedDashboard: true })
    expect(canUse('pro', 'inventory')).toBe(false)
    expect(canUse('business', 'inventory')).toBe(true)
    expect(PLAN_NAMES.business_plus).toBe('Business Plus')
  })
})

describe('svinn i kostnaden', () => {
  const potet = ing('potet', { price: 20, wastePercent: 20 }) // 20 kr/kg, 20 % skrell

  it('råvaresvinn: 1 kg potet til 20 kr med 20 % svinn koster 25 kr', () => {
    const r = recipeCost(rec('mos', { ingredients: [{ id: 'a', ingredientId: 'potet', amount: 1, unit: 'kg' }] }), ctx([], [potet]))
    expect(r.base.ingredients).toBeCloseTo(20)
    expect(r.base.waste).toBeCloseTo(5)
    expect(r.perUnit.total).toBeCloseTo(25)
  })

  it('tilberedningssvinn legges på hele oppskriften', () => {
    const r = recipeCost(rec('suppe', { yieldCount: 10, wastePercent: 10, ingredients: [{ id: 'a', ingredientId: 'x', amount: 1, unit: 'kg' }] }), ctx([], [ing('x', { price: 90 })]))
    expect(r.base.waste).toBeCloseTo(10) // 90 / 0,9 − 90
    expect(r.perUnit.waste).toBeCloseTo(1)
    expect(r.perUnit.total).toBeCloseTo(10)
  })

  it('svinn i underoppskrifter følger med andelen', () => {
    const saus = rec('saus', { finishedWeightG: 1000, wastePercent: 50, ingredients: [{ id: 'a', ingredientId: 'x', amount: 1, unit: 'kg' }] })
    const rett = rec('rett', { ingredients: [{ id: 'b', ingredientId: '', subRecipeId: 'saus', amount: 500, unit: 'g' }] })
    const r = recipeCost(rett, ctx([saus, rett], [ing('x', { price: 100 })]))
    expect(r.base.ingredients).toBeCloseTo(50)
    expect(r.base.waste).toBeCloseTo(50) // sausens svinn (100 kr) × 0,5
  })

  it('menyen viser svinn per porsjon', () => {
    const r = rec('mos', { ingredients: [{ id: 'a', ingredientId: 'potet', amount: 1, unit: 'kg' }] })
    const m = menuItemCalc({ id: 'i', recipeId: 'mos', name: '', price: 125, vatPercent: 25 }, ctx([r], [potet]))
    expect(m.cost?.waste).toBeCloseTo(5)
    expect(m.profit).toBeCloseTo(75)
  })
})

describe('priser og leverandører', () => {
  const suppliers: Supplier[] = [
    { id: 's1', name: 'ASKO', contactPerson: '', phone: '', email: '', customerNumber: '', comment: '' },
    { id: 's2', name: 'Servicegrossistene', contactPerson: '', phone: '', email: '', customerNumber: '', comment: '' },
  ]
  const mel = ing('mel', { packageSize: 25, unit: 'kg', price: 500, supplierId: 's1', priceUpdated: '2026-11-20' })
  const p = (q: Partial<PriceEntry>): PriceEntry => ({ id: Math.random().toString(), ingredientId: 'mel', supplierId: 's1', supplierItemNo: '', packageSize: 25, unit: 'kg', price: 450, vatPercent: 15, pricedAt: '2026-08-01', source: 'historikk', ...q })

  it('pris per kg, liter og stk', () => {
    expect(pricePerBaseUnit({ price: 30, packageSize: 500, unit: 'g' })).toEqual({ value: 60, unit: 'kg' })
    expect(pricePerBaseUnit({ price: 20, packageSize: 5, unit: 'dl' })).toEqual({ value: 40, unit: 'l' })
    expect(pricePerBaseUnit({ price: 1, packageSize: 0, unit: 'kg' })).toBeNull()
  })

  it('ny historikkrad bare når pris, pakning, enhet eller leverandør endres', () => {
    expect(priceChangeEntry(mel, { ...mel, comment: 'x' })).toBeNull()
    expect(priceChangeEntry(mel, { ...mel, price: 520 })).toMatchObject({ price: 520, source: 'historikk', pricedAt: '2026-11-20' })
    expect(priceChangeEntry(undefined, mel)).toMatchObject({ price: 500 })
    expect(priceChangeEntry(mel, { ...mel, supplierId: 's2' })).not.toBeNull()
  })

  it('sammenligner gjeldende pris med siste pris fra andre leverandører, billigst først', () => {
    const prices = [p({ supplierId: 's2', price: 440, pricedAt: '2026-09-01', source: 'tilbud' }), p({ supplierId: 's2', price: 480, pricedAt: '2026-06-01' }), p({ supplierId: 's1', price: 450 })]
    const offers = compareSuppliers(mel, prices, suppliers)
    expect(offers).toHaveLength(2)
    expect(offers[0]).toMatchObject({ supplierName: 'Servicegrossistene', price: 440, current: false, source: 'tilbud' })
    expect(offers[1]).toMatchObject({ supplierName: 'ASKO', current: true })
  })

  it('prisendring i prosent siden en dato', () => {
    const change = priceChangeSince(mel, [p({ price: 400, pricedAt: '2026-08-01' }), p({ price: 500, pricedAt: '2026-11-20' })], '2026-09-01')
    expect(change).toBeCloseTo(25)
    expect(priceChangeSince(mel, [], '2026-09-01')).toBeNull()
  })
})

describe('lager', () => {
  const mel = ing('mel', { unit: 'kg', packageSize: 25, price: 500, minStock: 10, wastePercent: 0 })
  const smor = ing('smor', { unit: 'g', packageSize: 500, price: 50, wastePercent: 10 })

  it('beholdning, verdi og varsel under minimum', () => {
    const levels = stockLevelsFrom([{ ingredientId: 'mel', quantity: 12 }, { ingredientId: 'mel', quantity: -4 }, { ingredientId: 'smor', quantity: 1000 }])
    expect(levels).toEqual({ mel: 8, smor: 1000 })
    const rows = stockOverview([mel, smor], levels)
    expect(rows[0]).toMatchObject({ quantity: 8, low: true })
    expect(rows[0].value).toBeCloseTo(160)
    expect(rows[1]).toMatchObject({ low: false, value: 100 })
    expect(unitCostOf(mel)).toBe(20)
  })

  it('forbruk fra en produksjon: skalering, underoppskrifter, råvaresvinn og enheter', () => {
    const deig = rec('deig', { yieldCount: 2, ingredients: [{ id: 'a', ingredientId: 'mel', amount: 500, unit: 'g' }] })
    const kake = rec('kake', {
      yieldCount: 4,
      ingredients: [
        { id: 'b', ingredientId: 'smor', amount: 90, unit: 'g' },
        { id: 'c', ingredientId: '', subRecipeId: 'deig', amount: 1, unit: 'stk' },
        { id: 'd', ingredientId: 'mel', amount: 1, unit: 'dl' }, // volum mot kg → hoppes over
      ],
    })
    const { usage, skipped } = consumption(kake, 8, [deig, kake], [mel, smor])
    expect(usage.smor).toBeCloseTo(200) // 90 g × 2 / 0,9
    expect(usage.mel).toBeCloseTo(0.5) // 1 deig av 2 = 250 g × 2 = 500 g = 0,5 kg
    expect(skipped).toEqual(['mel'])
    const moves = consumptionMovements(usage, [mel, smor], 'Produksjon')
    expect(moves.every((m) => m.quantity < 0 && m.kind === 'forbruk')).toBe(true)
    expect(moves.find((m) => m.ingredientId === 'mel')?.unitCost).toBe(20)
  })

  it('sirkulære underoppskrifter gir ikke uendelig løkke', () => {
    const a = rec('a', { ingredients: [{ id: '1', ingredientId: '', subRecipeId: 'b', amount: 1, unit: 'stk' }] })
    const b = rec('b', { ingredients: [{ id: '2', ingredientId: '', subRecipeId: 'a', amount: 1, unit: 'stk' }] })
    expect(consumption(a, 1, [a, b], []).skipped.length).toBeGreaterThan(0)
  })
})

describe('matsvinn', () => {
  const w = (p: Partial<WasteLog>): WasteLog => ({ id: Math.random().toString(), loggedAt: '2026-11-10', ingredientId: null, recipeId: null, name: 'Brød', amount: 1, unit: 'stk', cost: 10, reason: 'overproduksjon', note: '', ...p })

  it('sum per årsak og mest kastet i perioden', () => {
    const logs = [w({ cost: 30 }), w({ cost: 20, reason: 'utgatt', name: 'Melk' }), w({ cost: 15, name: 'Melk', reason: 'utgatt' }), w({ cost: 99, loggedAt: '2026-10-01' })]
    const s = wasteSummary(logs, '2026-11-01', '2026-11-30')
    expect(s).toMatchObject({ total: 65, count: 3 })
    expect(s.byReason[0]).toMatchObject({ reason: 'utgatt', cost: 35, count: 2 })
    expect(s.top[0]).toMatchObject({ name: 'Melk', cost: 35 })
  })

  it('månedssummer for trender, eldste først', () => {
    const rows = monthlyTotals([w({ loggedAt: '2026-11-10', cost: 5 }), w({ loggedAt: '2026-09-02', cost: 7 }), w({ loggedAt: '2025-01-01', cost: 100 })], (x) => x.loggedAt, (x) => x.cost, 3, new Date(2026, 10, 28))
    expect(rows).toEqual([{ month: '2026-09', total: 7 }, { month: '2026-10', total: 0 }, { month: '2026-11', total: 5 }])
  })
})

describe('lagring og bakoverkompatibilitet', () => {
  it('ingrediens med innkjøpsfelt går tur-retur', () => {
    const i = ing('x', { ean: '7038010000737', manufacturer: 'Møllerens', supplierId: 's1', supplierItemNo: 'A1', vatPercent: 15, wastePercent: 5, comment: 'k', minStock: 3 })
    const rpc = ingredientToRpc(i)
    expect(rpc).toMatchObject({ ean: '7038010000737', supplier_id: 's1', waste_percent: 5, min_stock: 3 })
    const back = ingredientFromRow({ ...rpc, id: 'x', organization_id: 'o', supplier_id: 's1', min_stock: '3', waste_percent: '5.00' })
    expect(back).toMatchObject({ ean: '7038010000737', supplierId: 's1', wastePercent: 5, minStock: 3, manufacturer: 'Møllerens' })
  })

  it('ugyldig strekkode og svinn holdes innenfor grensene', () => {
    expect(ingredientToRpc(ing('x', { ean: '123', wastePercent: 120 }))).toMatchObject({ ean: '', waste_percent: 94.99, min_stock: '' })
  })

  it('rader og lokale data fra før fase 4 får standardverdier', () => {
    const back = ingredientFromRow({ id: 'i', organization_id: 'o', name: 'X', category: '', package_size: 1, unit: 'kg', price: 1, store: '', price_updated: '' })
    expect(back).toMatchObject({ ean: '', supplierId: null, vatPercent: 15, wastePercent: 0, minStock: null })
    const old = { ...ing('y') } as Partial<Ingredient>
    delete old.wastePercent; delete old.supplierId; delete old.minStock
    expect(normalizeIngredient(old as Ingredient)).toMatchObject({ wastePercent: 0, supplierId: null, minStock: null })
    const oldRec = { ...rec('r') } as Partial<Recipe>
    delete oldRec.wastePercent
    expect(normalizeRecipe(oldRec as Recipe).wastePercent).toBe(0)
  })

  it('tilberedningssvinn på oppskriften går tur-retur', () => {
    const { recipe } = recipeToRpc(rec('r', { wastePercent: 12 }))
    expect(recipe.waste_percent).toBe(12)
    const row: RecipeRow = { ...recipe, organization_id: 'o', type: 'annet', created_at: '', updated_at: '', waste_percent: '12.00' }
    expect(recipeFromRow(row).wastePercent).toBe(12)
  })

  it('pris- og svinnrader', () => {
    expect(priceFromRow({ id: 'p', ingredient_id: 'i', supplier_id: null, supplier_item_no: null, package_size: '25', unit: 'kg', price: '450.00', vat_percent: null, priced_at: '2026-11-01', source: 'tilbud' }))
      .toMatchObject({ packageSize: 25, price: 450, source: 'tilbud', vatPercent: null })
    expect(wasteFromRow({ id: 'w', logged_at: '2026-11-01', ingredient_id: null, recipe_id: null, name: 'X', amount: '1', unit: 'kg', cost: '9.90', reason: 'ukjent', note: null }))
      .toMatchObject({ cost: 9.9, reason: 'annet' })
  })
})
