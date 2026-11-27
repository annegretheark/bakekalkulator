import { useMemo } from 'react'
import { computeBake } from '../utils/bake'
import { useData } from './useData'
import { useCheapestWindow, usePriceData } from './usePriceData'
import { useCostContext } from './useRecipeCosts'
import { subRecipeLineCost } from '../utils/recipeCost'

/**
 * Beregner resultatet for kalkulatorens gjeldende utkast.
 * Velger strømpris etter `priceBasis`; faller tilbake til dagens snitt
 * og deretter manuell pris dersom spotpris mangler.
 */
export function useBakeResult() {
  const { data, draft } = useData()
  const prices = usePriceData()
  const { window } = useCheapestWindow(draft.energy)
  const recipe = data.recipes.find((r) => r.id === draft.recipeId) ?? null
  const costCtx = useCostContext()

  return useMemo(() => {
    let price: number | null = null
    let priceSource = ''
    if (draft.priceBasis === 'cheapest' && window) { price = window.avgPricePerKwh; priceSource = 'billigste tidspunkt' }
    else if (draft.priceBasis === 'average' && prices.todayAverage !== null) { price = prices.todayAverage; priceSource = 'dagens snitt' }
    else if (prices.currentTotal !== null) { price = prices.currentTotal; priceSource = 'pris nå' }

    let fallback = false
    if (price === null) {
      if (prices.todayAverage !== null) { price = prices.todayAverage; priceSource = 'dagens snitt' }
      else { price = data.settings.price.manualTotalKrPerKwh; priceSource = 'manuell reservepris'; fallback = true }
    }

    const result = computeBake({
      energy: draft.energy,
      count: draft.count,
      recipe,
      ingredients: data.ingredients,
      pricePerKwh: price,
      storePricePerItem: draft.storePricePerItem,
      bakesPerMonth: data.settings.bakesPerMonth,
      // Underoppskrifter regnes med samme strømpris som resten av beregningen
      resolveSub: (l) => subRecipeLineCost(l, { ...costCtx, pricePerKwh: price }),
    })
    return { result, pricePerKwh: price, priceSource, fallback, recipe, window }
  }, [draft, recipe, data.ingredients, data.settings, prices.currentTotal, prices.todayAverage, window, costCtx])
}
