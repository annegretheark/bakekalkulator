import type { EnergyInput, EnergyResult, Ingredient, IngredientCostLine, Recipe } from '../types'
import { calculateEnergy, ovenKwh } from './energy'
import { batchComparison, calculateSavings, costPerItem, recipeCostLines, sumCosts, type BatchRow, type SavingsResult } from './costs'

export interface BakeInput {
  energy: EnergyInput
  count: number
  recipe: Recipe | null
  ingredients: Ingredient[]
  pricePerKwh: number
  storePricePerItem: number
  bakesPerMonth: number
}

export interface BakeResult {
  energy: EnergyResult
  electricityCost: number
  partCosts: { key: string; label: string; kwh: number; cost: number }[]
  ingredientLines: IngredientCostLine[]
  ingredientCost: number
  missingIngredientCosts: number
  totalCost: number
  costPerItem: number | null
  savings: SavingsResult | null
  batch: BatchRow[]
}

/** Samler alle beregninger for én baking. Rene funksjoner – ingen UI-avhengigheter. */
export function computeBake(input: BakeInput): BakeResult {
  const energy = calculateEnergy(input.energy)
  // Strømprisen kan være negativ (negativ spotpris) – da blir strømkostnaden negativ
  const price = Number.isFinite(input.pricePerKwh) ? input.pricePerKwh : 0
  const electricityCost = energy.totalKwh * price

  // Ved målt forbruk fordeles kostnaden proporsjonalt på delene
  const scale = energy.estimatedKwh > 0 ? energy.totalKwh / energy.estimatedKwh : 0
  const partCosts = energy.parts.map((p) => ({ ...p, kwh: p.kwh * scale, cost: p.kwh * scale * price }))

  const ingredientLines = input.recipe ? recipeCostLines(input.recipe, input.ingredients, input.count) : []
  const ingredientCost = sumCosts(ingredientLines)
  const totalCost = electricityCost + ingredientCost
  const perItem = costPerItem(totalCost, input.count)

  const oven = ovenKwh(input.energy) * scale * price
  const baseIngredientPerItem = input.count > 0 ? ingredientCost / input.count : 0

  return {
    energy,
    electricityCost,
    partCosts,
    ingredientLines,
    ingredientCost,
    missingIngredientCosts: ingredientLines.filter((l) => l.cost === null).length,
    totalCost,
    costPerItem: perItem,
    savings: input.storePricePerItem > 0 && perItem !== null
      ? calculateSavings(input.storePricePerItem, perItem, input.count, input.bakesPerMonth)
      : null,
    batch: batchComparison(input.count, oven, electricityCost - oven, baseIngredientPerItem * input.count),
  }
}
