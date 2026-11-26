import type { SalesInput, SalesResult } from '../types'

const nn = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0)

/** Fortjenestemargin = fortjeneste / omsetning (eks. mva). */
export function profitMargin(revenue: number, cost: number): number | null {
  if (!(revenue > 0)) return null
  return ((revenue - cost) / revenue) * 100
}

/** Påslag = fortjeneste / kostnad. */
export function markup(revenue: number, cost: number): number | null {
  if (!(cost > 0)) return null
  return ((revenue - cost) / cost) * 100
}

/** Pris (eks. mva) som gir ønsket margin: kostnad / (1 − margin). */
export function priceForMargin(cost: number, marginPercent: number): number | null {
  if (marginPercent >= 100 || cost < 0) return null
  return cost / (1 - marginPercent / 100)
}

export function calculateSales(input: SalesInput): SalesResult {
  const units = Math.floor(nn(input.units))
  const r = nn(input.vatRatePercent) / 100
  const soldUnits = units * (1 - Math.min(100, nn(input.wastePercent)) / 100)

  const totalCost =
    nn(input.ingredientCost) +
    nn(input.electricityCost) +
    nn(input.packagingPerUnit) * units +
    nn(input.laborHours) * nn(input.hourlyRate) +
    nn(input.transport) +
    nn(input.otherCosts)

  const priceExVat = input.priceIncludesVat ? nn(input.pricePerUnit) / (1 + r) : nn(input.pricePerUnit)
  const revenueExVat = priceExVat * soldUnits
  const profit = revenueExVat - totalCost
  const costPerSoldUnit = soldUnits > 0 ? totalCost / soldUnits : 0
  const rec = soldUnits > 0 ? priceForMargin(costPerSoldUnit, input.targetMarginPercent) : null

  return {
    totalCost,
    soldUnits,
    costPerSoldUnit,
    priceExVat,
    revenueExVat,
    vatAmount: revenueExVat * r,
    profit,
    marginPercent: profitMargin(revenueExVat, totalCost),
    markupPercent: markup(revenueExVat, totalCost),
    recommendedPriceExVat: rec,
    recommendedPriceInclVat: rec === null ? null : rec * (1 + r),
    breakEvenPriceExVat: soldUnits > 0 ? costPerSoldUnit : null,
  }
}
