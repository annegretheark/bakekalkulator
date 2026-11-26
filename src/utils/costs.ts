import type { Ingredient, IngredientCostLine, Recipe, RecipeIngredient, Unit } from '../types'
import { convert } from './units'

/**
 * Kostnad for en mengde av en ingrediens.
 * Eks.: 2 kg mel koster 32 kr, oppskriften bruker 750 g → 12 kr.
 * Returnerer null ved inkompatible enheter (f.eks. dl mot kg uten tetthet).
 */
export function ingredientCost(ingredient: Ingredient, amount: number, unit: Unit): number | null {
  if (!(ingredient.packageSize > 0) || !(amount >= 0)) return null
  const inPackageUnit = convert(amount, unit, ingredient.unit)
  if (inPackageUnit === null) return null
  return (inPackageUnit / ingredient.packageSize) * ingredient.price
}

export function scaleFactor(fromCount: number, toCount: number): number {
  if (!(fromCount > 0) || !(toCount >= 0)) return 1
  return toCount / fromCount
}

/** Skalerer ingrediensmengdene til ønsket antall bakervarer. */
export function scaleRecipeIngredients(items: RecipeIngredient[], fromCount: number, toCount: number): RecipeIngredient[] {
  const f = scaleFactor(fromCount, toCount)
  return items.map((i) => ({ ...i, amount: i.amount * f }))
}

export function recipeCostLines(recipe: Recipe, ingredients: Ingredient[], targetCount = recipe.yieldCount): IngredientCostLine[] {
  const byId = new Map(ingredients.map((i) => [i.id, i]))
  return scaleRecipeIngredients(recipe.ingredients, recipe.yieldCount, targetCount).map((ri) => {
    const ing = byId.get(ri.ingredientId)
    if (!ing) {
      return { recipeIngredientId: ri.id, name: 'Ukjent ingrediens', amount: ri.amount, unit: ri.unit, cost: null, error: 'Ingrediensen finnes ikke i registeret' }
    }
    const cost = ingredientCost(ing, ri.amount, ri.unit)
    return {
      recipeIngredientId: ri.id,
      name: ing.name,
      amount: ri.amount,
      unit: ri.unit,
      cost,
      error: cost === null ? `Kan ikke regne ${ri.unit} om til ${ing.unit} uten kjent tetthet` : undefined,
    }
  })
}

export function sumCosts(lines: IngredientCostLine[]): number {
  return lines.reduce((s, l) => s + (l.cost ?? 0), 0)
}

export function costPerItem(totalCost: number, count: number): number | null {
  return count > 0 ? totalCost / count : null
}

export interface SavingsResult {
  perItem: number
  perBake: number
  perMonth: number
  perYear: number
}

export function calculateSavings(storePricePerItem: number, ownCostPerItem: number, count: number, bakesPerMonth: number): SavingsResult {
  const perItem = storePricePerItem - ownCostPerItem
  const perBake = perItem * count
  const perMonth = perBake * Math.max(0, bakesPerMonth)
  return { perItem, perBake, perMonth, perYear: perMonth * 12 }
}

export interface BatchRow {
  multiplier: number
  count: number
  electricityCost: number
  ingredientCost: number
  totalCost: number
  costPerItem: number
}

/**
 * Hva skjer hvis man baker flere samtidig i samme ovnsomgang?
 * Forutsetter at ovnen har kapasitet: strøm til ovnen er den samme, ingrediensene skaleres.
 */
export function batchComparison(baseCount: number, ovenElectricityCost: number, otherElectricityCost: number, baseIngredientCost: number, multipliers = [1, 2, 3]): BatchRow[] {
  return multipliers.map((m) => {
    const count = baseCount * m
    const electricityCost = ovenElectricityCost + otherElectricityCost * m
    const ingredientCost = baseIngredientCost * m
    const totalCost = electricityCost + ingredientCost
    return { multiplier: m, count, electricityCost, ingredientCost, totalCost, costPerItem: count > 0 ? totalCost / count : 0 }
  })
}
