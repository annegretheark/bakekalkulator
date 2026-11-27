import { useCallback, useMemo } from 'react'
import type { Recipe } from '../types'
import { computeBake } from '../utils/bake'
import { recipeCost, subRecipeLineCost, type RecipeCostContext } from '../utils/recipeCost'
import { useData } from './useData'
import { usePriceData } from './usePriceData'

/** Strømpris for kalkulasjoner av oppskrifter og menyer: dagens snitt, pris nå eller manuell pris. */
export function useReferencePrice(): { price: number; source: string } {
  const { data } = useData()
  const prices = usePriceData()
  if (prices.todayAverage !== null) return { price: prices.todayAverage, source: 'dagens snittpris' }
  if (prices.currentTotal !== null) return { price: prices.currentTotal, source: 'strømprisen nå' }
  return { price: data.settings.price.manualTotalKrPerKwh, source: 'manuell reservepris' }
}

export function useCostContext(): RecipeCostContext {
  const { data } = useData()
  const { price } = useReferencePrice()
  return useMemo(() => ({
    recipes: data.recipes, ingredients: data.ingredients, equipment: data.equipment, costs: data.costs, pricePerKwh: price,
  }), [data.recipes, data.ingredients, data.equipment, data.costs, price])
}

export interface RecipeBreakdown {
  /** Kalkulatorens beregning: ingredienslinjer (inkl. underoppskrifter) og strøm, skalert. */
  bake: ReturnType<typeof computeBake>
  full: ReturnType<typeof recipeCost>
  count: number
  labor: number
  waste: number
  packaging: number
  overhead: number
  total: number
  perUnit: number | null
}

/**
 * Full kostnad for en oppskrift skalert til `count`: råvarer, strøm, personal,
 * emballasje og fordelte driftskostnader. `recipes` brukes når en oppskrift
 * redigeres og ikke er lagret ennå.
 */
export function useRecipeBreakdown() {
  const { data } = useData()
  const ctx = useCostContext()
  return useCallback((r: Recipe, count = r.yieldCount, recipes: Recipe[] = data.recipes): RecipeBreakdown => {
    const c = { ...ctx, recipes }
    const bake = computeBake({
      energy: { ...r.energy, bakeMinutes: r.bakeMinutes || r.energy.bakeMinutes }, count, recipe: r, ingredients: data.ingredients,
      pricePerKwh: ctx.pricePerKwh, storePricePerItem: r.storePricePerItem, bakesPerMonth: data.settings.bakesPerMonth,
      resolveSub: (l) => subRecipeLineCost(l, c),
    })
    const full = recipeCost(r, c)
    const labor = full.perUnit.labor * count
    const waste = full.perUnit.waste * count
    const packaging = full.perUnit.packaging * count
    const overhead = full.perUnit.overhead * count
    const total = bake.totalCost + labor + waste + packaging + overhead
    return { bake, full, count, labor, waste, packaging, overhead, total, perUnit: count > 0 ? total / count : null }
  }, [ctx, data.recipes, data.ingredients, data.settings.bakesPerMonth])
}
