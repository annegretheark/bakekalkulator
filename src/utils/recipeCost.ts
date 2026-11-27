import type { CostSettings, EquipmentItem, Id, Ingredient, Recipe, RecipeIngredient } from '../types'
import { ALLERGEN_CODES } from '../types'
import { emptyProfile, markToStatus, mergeProfiles, worstStatus, type AllergenProfile } from '../lib/allergens'
import { ingredientCost } from './costs'
import { calculateEnergy } from './energy'
import { convert, unitDimension } from './units'
import { laborCost, overhead } from './staffCosts'

/** Maks dybde for underoppskrifter (vern mot uendelig rekursjon i ødelagte data). */
const MAX_DEPTH = 8

export interface RecipeCostContext {
  recipes: Recipe[]
  ingredients: Ingredient[]
  equipment: EquipmentItem[]
  costs: CostSettings
  /** Strømpris (kr/kWh) for energikostnad og driftskostnad for kontinuerlig utstyr. */
  pricePerKwh: number
}

/**
 * Hvor stor del av underoppskriften en linje bruker.
 * g/kg regnes mot ferdig vekt, stk mot antall stk/porsjoner underoppskriften gir.
 */
export function subRecipeFraction(line: Pick<RecipeIngredient, 'amount' | 'unit'>, sub: Recipe): { fraction: number | null; error?: string } {
  if (!(line.amount >= 0)) return { fraction: null, error: 'Ugyldig mengde' }
  const dim = unitDimension(line.unit)
  if (dim === 'mass') {
    if (!sub.finishedWeightG || !(sub.finishedWeightG > 0)) {
      return { fraction: null, error: `«${sub.name}» mangler ferdig vekt. Oppgi mengden i stk/porsjoner, eller legg inn ferdig vekt` }
    }
    return { fraction: (convert(line.amount, line.unit, 'g') ?? 0) / sub.finishedWeightG }
  }
  if (dim === 'count') {
    if (!(sub.yieldCount > 0)) return { fraction: null, error: 'Underoppskriften mangler antall' }
    return { fraction: line.amount / sub.yieldCount }
  }
  return { fraction: null, error: 'Oppgi mengden av en underoppskrift i g, kg eller stk/porsjoner' }
}

/** Alle underoppskrifter som `recipeId` bruker, direkte eller indirekte. */
export function subRecipeIds(recipes: Recipe[], recipeId: Id): Set<Id> {
  const byId = new Map(recipes.map((r) => [r.id, r]))
  const seen = new Set<Id>()
  const stack = [recipeId]
  while (stack.length) {
    const r = byId.get(stack.pop() as Id)
    for (const l of r?.ingredients ?? []) {
      if (l.subRecipeId && !seen.has(l.subRecipeId)) { seen.add(l.subRecipeId); stack.push(l.subRecipeId) }
    }
  }
  return seen
}

/** true hvis `subId` som underoppskrift i `recipeId` ville gitt en sirkulær referanse. */
export function wouldCreateCycle(recipes: Recipe[], recipeId: Id, subId: Id): boolean {
  return subId === recipeId || subRecipeIds(recipes, subId).has(recipeId)
}

/** Oppskrifter som kan brukes som underoppskrift i `recipeId` uten sirkel. */
export function subRecipeCandidates(recipes: Recipe[], recipeId: Id): Recipe[] {
  return recipes.filter((r) => !wouldCreateCycle(recipes, recipeId, r.id))
}

/** Oppskrifter som bruker `subId` som underoppskrift (direkte). */
export function recipesUsingSub(recipes: Recipe[], subId: Id): Recipe[] {
  return recipes.filter((r) => r.ingredients.some((l) => l.subRecipeId === subId))
}

/** Kostnad for hele oppskriften (alle stk/porsjoner) uten emballasje og driftskostnader. */
export interface BaseCost {
  ingredients: number
  energy: number
  kwh: number
  labor: number
  laborHours: number
  /** Linjer som ikke kunne beregnes (ukjent ingrediens, enhet, sirkel ...). */
  warnings: string[]
  allergens: AllergenProfile
  /** Minst én ingrediens har allergener som ikke er kontrollert av kunden (f.eks. fra AI). */
  uncheckedAllergens: boolean
}

function baseCost(recipe: Recipe, ctx: RecipeCostContext, path: Id[]): BaseCost {
  const ingById = new Map(ctx.ingredients.map((i) => [i.id, i]))
  const recById = new Map(ctx.recipes.map((r) => [r.id, r]))
  const warnings: string[] = []
  let ingredients = 0
  let energyCost = 0
  let kwh = 0
  let labor = 0
  let laborHours = 0
  let unchecked = false
  // Uten linjer vet vi ingenting om allergenene
  let allergens = emptyProfile(recipe.ingredients.length ? 'fri' : 'ukjent')

  for (const line of recipe.ingredients) {
    if (line.subRecipeId) {
      const sub = recById.get(line.subRecipeId)
      if (!sub) {
        warnings.push('En underoppskrift finnes ikke lenger')
        allergens = mergeProfiles(allergens, emptyProfile('ukjent'))
        continue
      }
      if (path.includes(sub.id) || path.length >= MAX_DEPTH) {
        warnings.push(`Sirkulær referanse: «${sub.name}» bruker seg selv`)
        allergens = mergeProfiles(allergens, emptyProfile('ukjent'))
        continue
      }
      const subCost = baseCost(sub, ctx, [...path, sub.id])
      allergens = mergeProfiles(allergens, subCost.allergens)
      unchecked = unchecked || subCost.uncheckedAllergens
      warnings.push(...subCost.warnings.map((w) => `${sub.name}: ${w}`))
      const { fraction, error } = subRecipeFraction(line, sub)
      if (fraction === null) { warnings.push(error ?? 'Kan ikke beregne underoppskrift'); continue }
      ingredients += subCost.ingredients * fraction
      energyCost += subCost.energy * fraction
      kwh += subCost.kwh * fraction
      labor += subCost.labor * fraction
      laborHours += subCost.laborHours * fraction
      continue
    }
    const ing = ingById.get(line.ingredientId)
    if (!ing) {
      warnings.push('En ingrediens finnes ikke i registeret')
      allergens = mergeProfiles(allergens, emptyProfile('ukjent'))
      continue
    }
    const c = ingredientCost(ing, line.amount, line.unit)
    if (c === null) warnings.push(`${ing.name}: kan ikke regne ${line.unit} om til ${ing.unit}`)
    else ingredients += c
    for (const a of ALLERGEN_CODES) allergens[a] = worstStatus(allergens[a], markToStatus(ing.allergens?.[a]))
    if (ing.allergensChecked === false) unchecked = true
  }

  for (const a of recipe.crossContact ?? []) allergens[a] = worstStatus(allergens[a], 'krysskontakt')

  // Steketiden på oppskriften styrer ovnstiden (som i kalkulatoren)
  const e = calculateEnergy({ ...recipe.energy, bakeMinutes: recipe.bakeMinutes || recipe.energy.bakeMinutes })
  kwh += e.totalKwh
  energyCost += e.totalKwh * (Number.isFinite(ctx.pricePerKwh) ? ctx.pricePerKwh : 0)

  const l = laborCost(recipe.labor ?? [], ctx.costs.staffRoles)
  if (l.lines.some((x) => x.missingRole)) warnings.push('Arbeidstid med en rolle som er slettet')
  labor += l.cost
  laborHours += l.hours

  return { ingredients, energy: energyCost, kwh, labor, laborHours, warnings, allergens, uncheckedAllergens: unchecked }
}

export function recipeBaseCost(recipe: Recipe, ctx: RecipeCostContext): BaseCost {
  return baseCost(recipe, ctx, [recipe.id])
}

export interface UnitCost {
  ingredients: number
  energy: number
  labor: number
  packaging: number
  overhead: number
  total: number
}

export interface RecipeCostResult {
  base: BaseCost
  /** Per stk/porsjon. */
  perUnit: UnitCost
  /** Hele oppskriften. */
  batch: UnitCost
  /** Det finnes driftskostnader, men de er ikke fordelt fordi antall per måned mangler. */
  overheadMissing: boolean
}

/** Full kostnad for en oppskrift: råvarer, energi, personal, emballasje og fordelte driftskostnader. */
export function recipeCost(recipe: Recipe, ctx: RecipeCostContext): RecipeCostResult {
  const base = recipeBaseCost(recipe, ctx)
  const n = recipe.yieldCount > 0 ? recipe.yieldCount : 1
  const oh = overhead(ctx.costs, ctx.equipment, ctx.pricePerKwh)
  const ohPerUnit = oh.perUnit ?? 0
  const packaging = Math.max(0, recipe.packagingPerUnit || 0)
  const perUnit: UnitCost = {
    ingredients: base.ingredients / n,
    energy: base.energy / n,
    labor: base.labor / n,
    packaging,
    overhead: ohPerUnit,
    total: 0,
  }
  perUnit.total = perUnit.ingredients + perUnit.energy + perUnit.labor + perUnit.packaging + perUnit.overhead
  const batch: UnitCost = {
    ingredients: base.ingredients, energy: base.energy, labor: base.labor,
    packaging: packaging * n, overhead: ohPerUnit * n, total: perUnit.total * n,
  }
  return { base, perUnit, batch, overheadMissing: oh.totalPerMonth > 0 && oh.perUnit === null }
}

/** Kostnad for en underoppskriftslinje i kalkulatoren (råvarer og energi, allerede skalert mengde). */
export function subRecipeLineCost(line: RecipeIngredient, ctx: RecipeCostContext): { name: string; cost: number | null; error?: string } {
  const sub = ctx.recipes.find((r) => r.id === line.subRecipeId)
  if (!sub) return { name: 'Ukjent underoppskrift', cost: null, error: 'Underoppskriften finnes ikke lenger' }
  const { fraction, error } = subRecipeFraction(line, sub)
  if (fraction === null) return { name: sub.name, cost: null, error }
  const b = recipeBaseCost(sub, ctx)
  return { name: sub.name, cost: (b.ingredients + b.energy) * fraction }
}
