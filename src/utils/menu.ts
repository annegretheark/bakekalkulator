import type { Menu, MenuItem, Recipe } from '../types'
import { emptyProfile, type AllergenProfile } from '../lib/allergens'
import { recipeCost, type RecipeCostContext, type UnitCost } from './recipeCost'

export interface MenuItemCalc {
  item: MenuItem
  recipe: Recipe | null
  name: string
  /** Kostnad per porsjon/stk. null når oppskriften er slettet. */
  cost: UnitCost | null
  priceExVat: number
  vat: number
  profit: number | null
  /** Fortjeneste i prosent av pris eks. mva. */
  marginPercent: number | null
  /** Råvarekostnad i prosent av pris eks. mva. */
  foodCostPercent: number | null
  allergens: AllergenProfile
  uncheckedAllergens: boolean
  warnings: string[]
}

export function priceExVat(priceInclVat: number, vatPercent: number): number {
  const p = Number.isFinite(priceInclVat) ? Math.max(0, priceInclVat) : 0
  const v = Number.isFinite(vatPercent) ? Math.max(0, vatPercent) : 0
  return p / (1 + v / 100)
}

/** Kostnad, pris og fortjeneste for én rett på menyen. */
export function menuItemCalc(item: MenuItem, ctx: RecipeCostContext): MenuItemCalc {
  const recipe = ctx.recipes.find((r) => r.id === item.recipeId) ?? null
  const exVat = priceExVat(item.price, item.vatPercent)
  if (!recipe) {
    return {
      item, recipe: null, name: item.name || 'Slettet oppskrift', cost: null, priceExVat: exVat, vat: item.price - exVat,
      profit: null, marginPercent: null, foodCostPercent: null, allergens: emptyProfile('ukjent'), uncheckedAllergens: false,
      warnings: ['Oppskriften er slettet'],
    }
  }
  const rc = recipeCost(recipe, ctx)
  const cost = rc.perUnit
  const profit = exVat - cost.total
  return {
    item, recipe, name: item.name.trim() || recipe.name, cost, priceExVat: exVat, vat: item.price - exVat,
    profit: exVat > 0 ? profit : null,
    marginPercent: exVat > 0 ? (profit / exVat) * 100 : null,
    foodCostPercent: exVat > 0 ? (cost.ingredients / exVat) * 100 : null,
    allergens: rc.base.allergens,
    uncheckedAllergens: rc.base.uncheckedAllergens,
    warnings: [...rc.base.warnings, ...(rc.overheadMissing ? ['Driftskostnadene er ikke fordelt (antall per måned mangler)'] : [])],
  }
}

/** Pris inkl. mva som gir ønsket fortjeneste (prosent av pris eks. mva). null når målet er umulig. */
export function priceForMargin(costPerUnit: number, marginPercent: number, vatPercent: number): number | null {
  if (!(marginPercent < 100)) return null
  const exVat = costPerUnit / (1 - marginPercent / 100)
  return exVat * (1 + Math.max(0, vatPercent) / 100)
}

export interface MenuSummary {
  items: MenuItemCalc[]
  /** Snitt over retter med pris. */
  avgMarginPercent: number | null
  avgFoodCostPercent: number | null
}

export function menuSummary(menu: Menu, ctx: RecipeCostContext): MenuSummary {
  const items = menu.items.map((i) => menuItemCalc(i, ctx))
  const priced = items.filter((i) => i.marginPercent !== null)
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
  return {
    items,
    avgMarginPercent: avg(priced.map((i) => i.marginPercent as number)),
    avgFoodCostPercent: avg(priced.map((i) => i.foodCostPercent as number)),
  }
}
