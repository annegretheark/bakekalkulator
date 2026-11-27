import type { CostSettings, Ingredient, Menu, Recipe } from '../types'
import { ALLERGEN_CODES, MENU_TYPES } from '../types'
import { cleanAllergenMap } from '../lib/allergens'
import { defaultCostSettings } from '../lib/defaults'

/** Ferdig vekt (g) når oppskriften skaleres til `count` stk/porsjoner. */
export function scaledWeightG(recipe: Pick<Recipe, 'finishedWeightG' | 'yieldCount'>, count: number): number | null {
  if (!recipe.finishedWeightG || !(recipe.finishedWeightG > 0) || !(recipe.yieldCount > 0) || !(count > 0)) return null
  return recipe.finishedWeightG * (count / recipe.yieldCount)
}

/** Kostnad per kilo ferdig vare. null når ferdig vekt mangler. */
export function costPerKg(totalCost: number, weightG: number | null): number | null {
  if (weightG === null || !(weightG > 0)) return null
  return totalCost / (weightG / 1000)
}

/** Vekt per stk/porsjon (g). */
export function weightPerUnitG(recipe: Pick<Recipe, 'finishedWeightG' | 'yieldCount'>): number | null {
  if (!recipe.finishedWeightG || !(recipe.yieldCount > 0)) return null
  return recipe.finishedWeightG / recipe.yieldCount
}

/** Bakeverketype for historikken ut fra kategori (beholdes for bakoverkompatibilitet). */
export function bakeTypeForCategory(category: Recipe['category'], current: Recipe['type']): Recipe['type'] {
  if (category === 'pizza') return 'pizza'
  if (category === 'brod_bakervarer') return current === 'pizza' || current === 'annet' ? 'brod' : current
  return 'annet'
}

/** Kategori for eldre oppskrifter uten kategori (samme regel som migrasjonen). */
export function categoryForBakeType(type: Recipe['type']): Recipe['category'] {
  if (type === 'pizza') return 'pizza'
  if (type === 'annet') return 'annet'
  return 'brod_bakervarer'
}

/** Fyller inn nye felt for oppskrifter lagret før fase 1 (lokal lagring og import). */
export function normalizeRecipe(r: Recipe): Recipe {
  return {
    ...r,
    category: r.category ?? categoryForBakeType(r.type),
    yieldUnit: r.yieldUnit === 'porsjoner' ? 'porsjoner' : 'stk',
    prepMinutes: Number.isFinite(r.prepMinutes) ? r.prepMinutes : 0,
    finishedWeightG: typeof r.finishedWeightG === 'number' && r.finishedWeightG > 0 ? r.finishedWeightG : null,
    ingredients: Array.isArray(r.ingredients) ? r.ingredients.map((l) => ({ ...l, ingredientId: l.ingredientId ?? '', subRecipeId: l.subRecipeId || null })) : [],
    labor: Array.isArray(r.labor) ? r.labor : [],
    packagingPerUnit: Number.isFinite(r.packagingPerUnit) && r.packagingPerUnit > 0 ? r.packagingPerUnit : 0,
    crossContact: Array.isArray(r.crossContact) ? r.crossContact.filter((c) => ALLERGEN_CODES.includes(c)) : [],
  }
}

/** Fyller inn allergenfelt for ingredienser lagret før fase 2 (ukjent status). */
export function normalizeIngredient(i: Ingredient): Ingredient {
  return { ...i, allergens: cleanAllergenMap(i.allergens), allergensChecked: i.allergensChecked !== false }
}

export function normalizeCostSettings(c: Partial<CostSettings> | null | undefined): CostSettings {
  const def = defaultCostSettings()
  const units = Number(c?.unitsPerMonth)
  return {
    staffRoles: Array.isArray(c?.staffRoles) ? c.staffRoles : def.staffRoles,
    operatingCosts: Array.isArray(c?.operatingCosts) ? c.operatingCosts : def.operatingCosts,
    includeContinuousEquipment: typeof c?.includeContinuousEquipment === 'boolean' ? c.includeContinuousEquipment : def.includeContinuousEquipment,
    unitsPerMonth: Number.isFinite(units) && units > 0 ? units : 0,
  }
}

export function normalizeMenu(m: Menu): Menu {
  return {
    ...m,
    type: MENU_TYPES.includes(m.type) ? m.type : 'egen',
    description: m.description ?? '',
    items: Array.isArray(m.items) ? m.items : [],
  }
}
