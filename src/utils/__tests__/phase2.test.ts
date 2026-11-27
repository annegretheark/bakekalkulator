import { describe, expect, it } from 'vitest'
import type { AllergenMap, CostSettings, Ingredient, Menu, Recipe, StaffRole } from '../../types'
import { ALLERGEN_CODES } from '../../types'
import { defaultCostSettings, ingredientExtras, defaultEnergyInput, defaultStaffRole } from '../../lib/defaults'
import { cleanAllergenMap, markToStatus } from '../../lib/allergens'
import { recipeBaseCost, recipeCost, subRecipeCandidates, subRecipeFraction, subRecipeLineCost, wouldCreateCycle, type RecipeCostContext } from '../recipeCost'
import { hourlyCost, laborCost, overhead } from '../staffCosts'
import { menuItemCalc, menuSummary, priceExVat, priceForMargin } from '../menu'
import { normalizeCostSettings, normalizeIngredient, normalizeRecipe } from '../portions'
import { ingredientFromRow, ingredientToRpc, menuFromRow, menuToRpc, recipeFromRow, recipeToRpc, type RecipeRow } from '../../services/storage/mappers'
import { buildImportPayload } from '../../services/importLocal'
import { recipeCostLines } from '../costs'
import { equipmentFromTemplate } from '../../lib/equipmentTemplates'

const allNo = (contains: Partial<AllergenMap> = {}): AllergenMap => ({ ...Object.fromEntries(ALLERGEN_CODES.map((c) => [c, 'nei'])), ...contains })

const ing = (id: string, price: number, allergens: AllergenMap, unit: Ingredient['unit'] = 'kg', checked = true): Ingredient => ({
  id, name: id, category: '', packageSize: 1, unit, price, store: '', priceUpdated: '2026-11-28', allergens, allergensChecked: checked, ...ingredientExtras(),
})

// Ingen strøm i testoppskriftene: manuelt oppsett med 0 W
const noEnergy = () => ({ ...defaultEnergyInput(), ovenWatt: 0, mixerWatt: 0, preheatMinutes: 0, bakeMinutes: 0 })

const rec = (id: string, p: Partial<Recipe> = {}): Recipe => ({
  id, name: id, type: 'annet', category: 'annet', yieldCount: 4, yieldUnit: 'porsjoner', prepMinutes: 0, finishedWeightG: null,
  ingredients: [], labor: [], packagingPerUnit: 0, crossContact: [], wastePercent: 0, steps: [], riseMinutes: 0, bakeMinutes: 0,
  storePricePerItem: 0, notes: '', energy: noEnergy(), createdAt: '', updatedAt: '', ...p,
})

const mel = ing('mel', 20, allNo({ gluten: 'ja' }))
const tomat = ing('tomat', 30, allNo())
const ost = ing('ost', 100, { melk: 'ja' }) // de andre 13 er ukjente
const sesamspor = ing('frø', 50, allNo({ sesam: 'spor' }))

const saus = rec('saus', { name: 'Tomatsaus', yieldCount: 1, finishedWeightG: 1000, ingredients: [{ id: 'a', ingredientId: 'tomat', amount: 1, unit: 'kg' }] })
const pizza = rec('pizza', {
  name: 'Pizza', yieldCount: 2,
  ingredients: [
    { id: 'b', ingredientId: 'mel', amount: 500, unit: 'g' },
    { id: 'c', ingredientId: '', subRecipeId: 'saus', amount: 250, unit: 'g' },
  ],
})

const ctx = (p: Partial<RecipeCostContext> = {}): RecipeCostContext => ({
  recipes: [saus, pizza], ingredients: [mel, tomat, ost, sesamspor], equipment: [], costs: defaultCostSettings(), pricePerKwh: 1, ...p,
})

describe('allergener', () => {
  it('manglende opplysning er ukjent, aldri «inneholder ikke»', () => {
    expect(markToStatus(undefined)).toBe('ukjent')
    expect(markToStatus('nei')).toBe('fri')
  })

  it('beregnes gjennom underoppskrifter', () => {
    const a = recipeBaseCost(pizza, ctx()).allergens
    expect(a.gluten).toBe('inneholder')
    expect(a.melk).toBe('fri')
    expect(ALLERGEN_CODES.filter((c) => a[c] === 'ukjent')).toEqual([])
  })

  it('én ingrediens med ukjente allergener gjør retten ukjent for dem', () => {
    const r = rec('r', { ingredients: [{ id: 'x', ingredientId: 'mel', amount: 1, unit: 'kg' }, { id: 'y', ingredientId: 'ost', amount: 100, unit: 'g' }] })
    const a = recipeBaseCost(r, ctx()).allergens
    expect(a.melk).toBe('inneholder')
    expect(a.gluten).toBe('inneholder')
    expect(a.egg).toBe('ukjent')
  })

  it('spor, krysskontakt og oppskrift uten ingredienser', () => {
    const r = rec('r', { ingredients: [{ id: 'x', ingredientId: 'frø', amount: 1, unit: 'kg' }], crossContact: ['peanotter', 'sesam'] })
    const a = recipeBaseCost(r, ctx()).allergens
    expect(a.sesam).toBe('spor') // spor er mer alvorlig enn krysskontakt
    expect(a.peanotter).toBe('krysskontakt')
    expect(a.egg).toBe('fri')
    expect(recipeBaseCost(rec('tom'), ctx()).allergens.gluten).toBe('ukjent')
  })

  it('slettet ingrediens gir ukjent status', () => {
    const r = rec('r', { ingredients: [{ id: 'x', ingredientId: 'borte', amount: 1, unit: 'kg' }] })
    const b = recipeBaseCost(r, ctx())
    expect(b.allergens.gluten).toBe('ukjent')
    expect(b.warnings).toHaveLength(1)
  })

  it('ukontrollerte allergener (AI/skanning) flagges', () => {
    const r = rec('r', { ingredients: [{ id: 'x', ingredientId: 'ai', amount: 1, unit: 'kg' }] })
    expect(recipeBaseCost(r, ctx({ ingredients: [ing('ai', 10, allNo(), 'kg', false)] })).uncheckedAllergens).toBe(true)
  })

  it('renser lagrede allergenkart', () => {
    expect(cleanAllergenMap({ gluten: 'ja', kokos: 'ja', melk: 'kanskje', egg: 'spor' })).toEqual({ gluten: 'ja', egg: 'spor' })
    expect(cleanAllergenMap(null)).toEqual({})
    expect(cleanAllergenMap(['gluten'])).toEqual({})
  })
})

describe('underoppskrifter', () => {
  it('andel regnes fra ferdig vekt eller antall', () => {
    expect(subRecipeFraction({ amount: 250, unit: 'g' }, saus).fraction).toBeCloseTo(0.25)
    expect(subRecipeFraction({ amount: 0.5, unit: 'kg' }, saus).fraction).toBeCloseTo(0.5)
    expect(subRecipeFraction({ amount: 2, unit: 'stk' }, rec('d', { yieldCount: 8 })).fraction).toBeCloseTo(0.25)
    expect(subRecipeFraction({ amount: 2, unit: 'dl' }, saus).fraction).toBeNull()
    expect(subRecipeFraction({ amount: 100, unit: 'g' }, rec('d')).error).toMatch(/ferdig vekt/)
  })

  it('kostnad: 500 g mel (10 kr) + 250 g saus (1 kg tomat 30 kr → 7,50 kr)', () => {
    const b = recipeBaseCost(pizza, ctx())
    expect(b.ingredients).toBeCloseTo(17.5)
    expect(b.warnings).toEqual([])
  })

  it('linje i kalkulatoren skaleres', () => {
    const lines = recipeCostLines(pizza, ctx().ingredients, 4, (l) => subRecipeLineCost(l, ctx()))
    expect(lines[1]).toMatchObject({ name: 'Tomatsaus (underoppskrift)', amount: 500 })
    expect(lines[1].cost).toBeCloseTo(15)
  })

  it('sirkulære referanser oppdages og gir ikke uendelig løkke', () => {
    const recipes = [saus, pizza]
    expect(wouldCreateCycle(recipes, 'saus', 'pizza')).toBe(true)
    expect(wouldCreateCycle(recipes, 'pizza', 'pizza')).toBe(true)
    expect(wouldCreateCycle(recipes, 'pizza', 'saus')).toBe(false)
    expect(subRecipeCandidates(recipes, 'saus').map((r) => r.id)).toEqual([])

    const a = rec('a', { ingredients: [{ id: '1', ingredientId: '', subRecipeId: 'b', amount: 1, unit: 'stk' }] })
    const b = rec('b', { ingredients: [{ id: '2', ingredientId: '', subRecipeId: 'a', amount: 1, unit: 'stk' }] })
    const res = recipeBaseCost(a, ctx({ recipes: [a, b] }))
    expect(res.warnings.join(' ')).toMatch(/Sirkulær/)
    expect(res.allergens.gluten).toBe('ukjent')
  })
})

describe('personalkostnader', () => {
  const role: StaffRole = { ...defaultStaffRole('k'), hourlyWage: 200, holidayPayPercent: 12, pensionPercent: 2, employerTaxPercent: 14.1, otherPercent: 5 }

  it('detaljert timekostnad', () => {
    const h = hourlyCost(role)
    expect(h.holidayPay).toBeCloseTo(24)
    expect(h.pension).toBeCloseTo(4)
    expect(h.employerTax).toBeCloseTo(228 * 0.141)
    expect(h.other).toBeCloseTo(10)
    expect(h.total).toBeCloseTo(200 + 24 + 4 + 32.148 + 10)
  })

  it('ferdig timekostnad brukes uendret', () => {
    expect(hourlyCost({ ...role, mode: 'ferdig', fixedHourlyCost: 400 }).total).toBe(400)
  })

  it('arbeidstid: personer × minutter × timekostnad, slettet rolle flagges', () => {
    const fixed = { ...role, mode: 'ferdig' as const, fixedHourlyCost: 300 }
    const l = laborCost([{ id: '1', roleId: 'k', people: 2, minutes: 30 }, { id: '2', roleId: 'borte', people: 1, minutes: 60 }], [fixed])
    expect(l.hours).toBe(2)
    expect(l.cost).toBe(300)
    expect(l.lines[1].missingRole).toBe(true)
  })
})

describe('driftskostnader', () => {
  const costs: CostSettings = { ...defaultCostSettings(), operatingCosts: [{ id: 'h', name: 'Husleie', amountPerMonth: 20000 }], unitsPerMonth: 4000 }
  const fridge = { ...equipmentFromTemplate('kjoleskap', 'k'), watt: 1000, powerPercent: 50, hoursPerDay: 24 } // 12 kWh/døgn

  it('faste kostnader og kontinuerlig utstyr fordeles per enhet', () => {
    const o = overhead(costs, [fridge], 2)
    expect(o.equipmentKwhPerMonth).toBeCloseTo(360)
    expect(o.equipmentPerMonth).toBeCloseTo(720)
    expect(o.perUnit).toBeCloseTo(20720 / 4000)
    expect(overhead({ ...costs, includeContinuousEquipment: false }, [fridge], 2).perUnit).toBeCloseTo(5)
  })

  it('uten antall per måned fordeles ingenting', () => {
    expect(overhead({ ...costs, unitsPerMonth: 0 }, [], 1).perUnit).toBeNull()
  })
})

describe('full kostnad per porsjon', () => {
  const costs: CostSettings = {
    ...defaultCostSettings(),
    staffRoles: [{ ...defaultStaffRole('k'), mode: 'ferdig', fixedHourlyCost: 360 }],
    operatingCosts: [{ id: 'h', name: 'Husleie', amountPerMonth: 10000 }],
    unitsPerMonth: 5000,
  }
  const dish = rec('dish', { ...pizza, id: 'dish', labor: [{ id: 'l', roleId: 'k', people: 1, minutes: 20 }], packagingPerUnit: 3 })

  it('råvarer, personal, emballasje og drift per porsjon', () => {
    const r = recipeCost(dish, ctx({ costs, recipes: [saus, dish] }))
    expect(r.perUnit.ingredients).toBeCloseTo(17.5 / 2)
    expect(r.perUnit.labor).toBeCloseTo(120 / 2)
    expect(r.perUnit.packaging).toBe(3)
    expect(r.perUnit.overhead).toBeCloseTo(2)
    expect(r.perUnit.total).toBeCloseTo(8.75 + 60 + 3 + 2)
    expect(r.batch.total).toBeCloseTo(r.perUnit.total * 2)
    expect(r.overheadMissing).toBe(false)
  })

  it('arbeidstid i underoppskrifter tas med', () => {
    const sausMedArbeid = { ...saus, labor: [{ id: 's', roleId: 'k', people: 1, minutes: 60 }] } // 360 kr for 1 kg
    const r = recipeCost(pizza, ctx({ costs, recipes: [sausMedArbeid, pizza] }))
    expect(r.base.labor).toBeCloseTo(90) // 250 g av 1 kg
  })
})

describe('menyer', () => {
  const costs: CostSettings = { ...defaultCostSettings(), staffRoles: [{ ...defaultStaffRole('k'), mode: 'ferdig', fixedHourlyCost: 300 }] }
  const dish = rec('dish', { ...pizza, id: 'dish', yieldCount: 1, labor: [{ id: 'l', roleId: 'k', people: 1, minutes: 6 }] }) // 17,50 + 30 = 47,50
  const c = ctx({ costs, recipes: [saus, dish] })

  it('pris eks. mva, fortjeneste, margin og råvareandel', () => {
    expect(priceExVat(125, 25)).toBeCloseTo(100)
    const m = menuItemCalc({ id: 'i', recipeId: 'dish', name: '', price: 125, vatPercent: 25 }, c)
    expect(m.name).toBe('Pizza') // tomt menynavn gir oppskriftens navn
    expect(m.cost?.total).toBeCloseTo(47.5)
    expect(m.profit).toBeCloseTo(52.5)
    expect(m.marginPercent).toBeCloseTo(52.5)
    expect(m.foodCostPercent).toBeCloseTo(17.5)
    expect(m.allergens.gluten).toBe('inneholder')
  })

  it('slettet oppskrift og rett uten pris', () => {
    const gone = menuItemCalc({ id: 'i', recipeId: 'borte', name: 'Suppe', price: 100, vatPercent: 25 }, c)
    expect(gone).toMatchObject({ cost: null, profit: null, name: 'Suppe' })
    expect(gone.allergens.melk).toBe('ukjent')
    expect(menuItemCalc({ id: 'i', recipeId: 'dish', name: '', price: 0, vatPercent: 25 }, c).marginPercent).toBeNull()
  })

  it('prisforslag for ønsket margin', () => {
    expect(priceForMargin(50, 50, 25)).toBeCloseTo(125)
    expect(priceForMargin(50, 100, 25)).toBeNull()
  })

  it('snitt over retter med pris', () => {
    const menu: Menu = { id: 'm', name: 'Lunsj', type: 'lunsj', description: '', createdAt: '', updatedAt: '', items: [
      { id: '1', recipeId: 'dish', name: '', price: 125, vatPercent: 25 },
      { id: '2', recipeId: 'dish', name: '', price: 0, vatPercent: 25 },
    ] }
    expect(menuSummary(menu, c).avgMarginPercent).toBeCloseTo(52.5)
  })
})

describe('lagring og bakoverkompatibilitet', () => {
  it('ingrediens med allergener går tur-retur', () => {
    const rpc = ingredientToRpc(ost)
    expect(rpc).toMatchObject({ allergens: { melk: 'ja' }, allergens_checked: true })
    const back = ingredientFromRow({ ...rpc, id: 'ost', organization_id: 'o', allergens: { melk: 'ja', kokos: 'ja' }, allergens_checked: null })
    expect(back.allergens).toEqual({ melk: 'ja' })
    expect(back.allergensChecked).toBe(true)
  })

  it('oppskrift med underoppskrift, arbeidstid, emballasje og krysskontakt går tur-retur', () => {
    const r = { ...pizza, labor: [{ id: 'l', roleId: 'k', people: 2, minutes: 15 }], packagingPerUnit: 4, crossContact: ['sesam' as const] }
    const { recipe, lines } = recipeToRpc(r)
    expect(lines[1]).toMatchObject({ ingredient_id: null, sub_recipe_id: 'saus' })
    expect(lines[0]).toMatchObject({ ingredient_id: 'mel', sub_recipe_id: null })
    const row: RecipeRow = {
      ...recipe, organization_id: 'o', type: 'annet', created_at: '', updated_at: '',
      recipe_ingredients: lines.map((l, i) => ({ id: `ri${i}`, ingredient_id: l.ingredient_id, sub_recipe_id: l.sub_recipe_id, position: i, amount: String(l.amount), unit: l.unit })),
      cross_contact: ['sesam', 'kokos'],
    }
    const back = recipeFromRow(row)
    expect(back.ingredients[1]).toMatchObject({ ingredientId: '', subRecipeId: 'saus' })
    expect(back.labor).toEqual([{ id: 'l', roleId: 'k', people: 2, minutes: 15 }])
    expect(back.packagingPerUnit).toBe(4)
    expect(back.crossContact).toEqual(['sesam'])
  })

  it('rader fra før fase 2 får tomme standardverdier', () => {
    const back = recipeFromRow({ id: 'x', organization_id: 'o', name: 'Gammel', type: 'brod', yield_count: 1, steps: null, rise_minutes: 0, bake_minutes: 0,
      store_price_per_item: 0, notes: '', energy: null, created_at: '', updated_at: '' })
    expect(back).toMatchObject({ labor: [], packagingPerUnit: 0, crossContact: [] })
    expect(ingredientFromRow({ id: 'i', organization_id: 'o', name: 'X', category: '', package_size: 1, unit: 'kg', price: 1, store: '', price_updated: '' }).allergens).toEqual({})
  })

  it('lokale data fra før fase 2 normaliseres', () => {
    const old = { ...pizza } as Partial<Recipe>
    delete old.labor; delete old.packagingPerUnit; delete old.crossContact
    expect(normalizeRecipe(old as Recipe)).toMatchObject({ labor: [], packagingPerUnit: 0, crossContact: [] })
    const oldIng = { ...mel } as Partial<Ingredient>
    delete oldIng.allergens; delete oldIng.allergensChecked
    expect(normalizeIngredient(oldIng as Ingredient)).toMatchObject({ allergens: {}, allergensChecked: true, ...ingredientExtras() })
    expect(normalizeCostSettings(undefined)).toEqual(defaultCostSettings())
    expect(normalizeCostSettings({ unitsPerMonth: -5, staffRoles: 'x' as never })).toMatchObject({ unitsPerMonth: 0, staffRoles: [] })
  })

  it('meny går tur-retur, og verdier holdes innenfor grensene', () => {
    const m: Menu = { id: 'm', name: ' Lunsj ', type: 'lunsj', description: '', createdAt: 'c', updatedAt: 'u', items: [{ id: '1', recipeId: 'r', name: '', price: 2e7, vatPercent: 25 }] }
    const rpc = menuToRpc(m)
    expect(rpc).toMatchObject({ name: 'Lunsj', menu_type: 'lunsj' })
    expect(rpc.items[0].price).toBe(1000000)
    const back = menuFromRow({ ...rpc, organization_id: 'o', created_at: 'c', updated_at: 'u', menu_type: 'brunsj' })
    expect(back.type).toBe('egen')
    expect(back.items[0]).toMatchObject({ recipeId: 'r', vatPercent: 25 })
  })

  it('import sender allergener og underoppskrifter som lokale id-er', () => {
    const p = buildImportPayload({ ingredients: [mel, tomat], recipes: [saus, pizza] })
    expect(p.ingredients[0].allergens).toMatchObject({ gluten: 'ja' })
    const pz = p.recipes.find((r) => r.local_id === 'pizza')!
    expect(pz.ingredients[1]).toEqual({ ingredient_local_id: null, sub_recipe_local_id: 'saus', amount: 250, unit: 'g' })
    expect(pz.ingredients[0]).toMatchObject({ ingredient_local_id: 'mel', sub_recipe_local_id: null })
  })
})
