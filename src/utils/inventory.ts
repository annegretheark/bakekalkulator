// Leverandørpriser, lager og matsvinn. Rene funksjoner – testes isolert.
import type { AppData, Id, Ingredient, PriceEntry, Recipe, StockMovement, Supplier, WasteLog, WasteReason } from '../types'
import { convert, unitDimension } from './units'
import { ingredientCost } from './costs'
import { subRecipeFraction } from './recipeCost'
import { scaleFactor } from './costs'
import { toLocalDateKey, uid } from './format'

export const WASTE_REASON_NAMES: Record<WasteReason, string> = {
  utgatt: 'Gått ut på dato',
  odelagt: 'Ødelagt eller dårlig',
  overproduksjon: 'Overproduksjon',
  tilberedning: 'Tilberedning (svidd, feil)',
  tallerken: 'Tallerkensvinn',
  annet: 'Annet',
}

/** Pris per kg, liter eller stk (sammenlignbar mellom pakninger). */
export function pricePerBaseUnit(p: { price: number; packageSize: number; unit: Ingredient['unit'] }): { value: number; unit: 'kg' | 'l' | 'stk' } | null {
  if (!(p.packageSize > 0)) return null
  const dim = unitDimension(p.unit)
  const base = dim === 'mass' ? 'kg' : dim === 'volume' ? 'l' : 'stk'
  const size = convert(p.packageSize, p.unit, base)
  return size && size > 0 ? { value: p.price / size, unit: base } : null
}

/**
 * Ny rad i prishistorikken når pris, pakning, enhet eller leverandør endres
 * (samme regel som triggeren record_ingredient_price i databasen).
 */
export function priceChangeEntry(prev: Ingredient | undefined, next: Ingredient): PriceEntry | null {
  if (prev && prev.price === next.price && prev.packageSize === next.packageSize && prev.unit === next.unit && prev.supplierId === next.supplierId) return null
  return {
    id: uid(), ingredientId: next.id, supplierId: next.supplierId, supplierItemNo: next.supplierItemNo, packageSize: next.packageSize,
    unit: next.unit, price: next.price, vatPercent: next.vatPercent, pricedAt: next.priceUpdated || toLocalDateKey(new Date()), source: 'historikk',
  }
}

export function withIngredientPrice(d: AppData, next: Ingredient): AppData {
  const entry = priceChangeEntry(d.ingredients.find((i) => i.id === next.id), next)
  return entry ? { ...d, prices: [entry, ...d.prices] } : d
}

export interface SupplierOffer {
  supplierId: Id | null
  supplierName: string
  price: number
  packageSize: number
  unit: Ingredient['unit']
  pricedAt: string
  perBase: { value: number; unit: 'kg' | 'l' | 'stk' } | null
  current: boolean
  source: PriceEntry['source']
  entryId: Id | null
}

/**
 * Sammenligning av innkjøpspriser for en ingrediens: gjeldende pris pluss siste
 * pris fra hver annen leverandør (historikk og tilbud), billigst først.
 */
export function compareSuppliers(ing: Ingredient, prices: PriceEntry[], suppliers: Supplier[]): SupplierOffer[] {
  const name = (id: Id | null) => (id ? suppliers.find((s) => s.id === id)?.name ?? 'Slettet leverandør' : ing.store || 'Uten leverandør')
  const current: SupplierOffer = {
    supplierId: ing.supplierId, supplierName: name(ing.supplierId), price: ing.price, packageSize: ing.packageSize, unit: ing.unit,
    pricedAt: ing.priceUpdated, perBase: pricePerBaseUnit(ing), current: true, source: 'historikk', entryId: null,
  }
  const latest = new Map<string, PriceEntry>()
  for (const p of prices) {
    if (p.ingredientId !== ing.id) continue
    const key = p.supplierId ?? ''
    if (key === (ing.supplierId ?? '')) continue
    const prev = latest.get(key)
    if (!prev || p.pricedAt > prev.pricedAt || (p.pricedAt === prev.pricedAt && p.source === 'tilbud')) latest.set(key, p)
  }
  const others = [...latest.values()].map((p): SupplierOffer => ({
    supplierId: p.supplierId, supplierName: name(p.supplierId), price: p.price, packageSize: p.packageSize, unit: p.unit,
    pricedAt: p.pricedAt, perBase: pricePerBaseUnit(p), current: false, source: p.source, entryId: p.id,
  }))
  return [current, ...others].sort((a, b) => (a.perBase?.value ?? Infinity) - (b.perBase?.value ?? Infinity))
}

/** Prisendring i prosent for en ingrediens siden en dato (fra historikken). null uten grunnlag. */
export function priceChangeSince(ing: Ingredient, prices: PriceEntry[], since: string): number | null {
  const now = pricePerBaseUnit(ing)
  if (!now) return null
  const older = prices
    .filter((p) => p.ingredientId === ing.id && p.source === 'historikk' && p.pricedAt <= since)
    .sort((a, b) => b.pricedAt.localeCompare(a.pricedAt))[0]
    ?? prices.filter((p) => p.ingredientId === ing.id && p.source === 'historikk').sort((a, b) => a.pricedAt.localeCompare(b.pricedAt))[0]
  const then = older ? pricePerBaseUnit(older) : null
  if (!then || then.unit !== now.unit || !(then.value > 0)) return null
  return ((now.value - then.value) / then.value) * 100
}

// ---------- Lager ----------

/** Pris per enhet av ingrediensens enhet (for lagerverdi og svinnkostnad). */
export function unitCostOf(ing: Ingredient): number {
  return ing.packageSize > 0 ? ing.price / ing.packageSize : 0
}

export interface StockRow {
  ingredient: Ingredient
  quantity: number
  value: number
  low: boolean
}

export function stockOverview(ingredients: Ingredient[], levels: Record<Id, number>): StockRow[] {
  return ingredients.map((ingredient) => {
    const quantity = levels[ingredient.id] ?? 0
    return {
      ingredient, quantity,
      value: Math.max(0, quantity) * unitCostOf(ingredient),
      low: ingredient.minStock !== null && quantity < ingredient.minStock,
    }
  })
}

/**
 * Hvor mye av hver ingrediens en produksjon bruker, i ingrediensens egen enhet.
 * Underoppskrifter regnes ned til ingrediensene sine. Råvaresvinn tas med (mer
 * må tas ut av lageret enn det som havner i retten). Linjer som ikke kan regnes
 * om (f.eks. dl mot kg), hoppes over og returneres i `skipped`.
 */
export function consumption(recipe: Recipe, count: number, recipes: Recipe[], ingredients: Ingredient[]): { usage: Record<Id, number>; skipped: string[] } {
  const usage: Record<Id, number> = {}
  const skipped: string[] = []
  const ingById = new Map(ingredients.map((i) => [i.id, i]))
  const recById = new Map(recipes.map((r) => [r.id, r]))
  const walk = (r: Recipe, factor: number, path: Id[]) => {
    for (const l of r.ingredients) {
      if (l.subRecipeId) {
        const sub = recById.get(l.subRecipeId)
        if (!sub || path.includes(sub.id) || path.length > 8) { skipped.push(sub?.name ?? 'Ukjent underoppskrift'); continue }
        const { fraction } = subRecipeFraction({ amount: l.amount * factor, unit: l.unit }, sub)
        if (fraction === null) { skipped.push(sub.name); continue }
        walk(sub, fraction, [...path, sub.id])
        continue
      }
      const ing = ingById.get(l.ingredientId)
      if (!ing) continue
      const qty = convert(l.amount * factor, l.unit, ing.unit)
      if (qty === null) { skipped.push(ing.name); continue }
      const waste = Math.min(Math.max(ing.wastePercent || 0, 0), 94.99)
      usage[ing.id] = (usage[ing.id] ?? 0) + qty / (1 - waste / 100)
    }
  }
  walk(recipe, scaleFactor(recipe.yieldCount, count), [recipe.id])
  return { usage, skipped }
}

export function consumptionMovements(usage: Record<Id, number>, ingredients: Ingredient[], note: string, at = new Date().toISOString()): StockMovement[] {
  return Object.entries(usage)
    .filter(([, q]) => q > 0)
    .map(([ingredientId, q]) => {
      const ing = ingredients.find((i) => i.id === ingredientId)
      return { id: uid(), ingredientId, quantity: -Math.round(q * 10000) / 10000, kind: 'forbruk' as const, movedAt: at, unitCost: ing ? unitCostOf(ing) : 0, note }
    })
}

// ---------- Matsvinn ----------

/** Kostnad for en svinnmengde av en ingrediens (null hvis enheten ikke kan regnes om). */
export function wasteCostForIngredient(ing: Ingredient, amount: number, unit: Ingredient['unit']): number | null {
  return ingredientCost(ing, amount, unit)
}

export interface WasteSummary {
  total: number
  count: number
  byReason: { reason: WasteReason; cost: number; count: number }[]
  top: { name: string; cost: number; count: number }[]
}

export function wasteSummary(logs: WasteLog[], from: string, to: string): WasteSummary {
  const inRange = logs.filter((w) => w.loggedAt >= from && w.loggedAt <= to)
  const byReason = new Map<WasteReason, { cost: number; count: number }>()
  const byName = new Map<string, { cost: number; count: number }>()
  for (const w of inRange) {
    const r = byReason.get(w.reason) ?? { cost: 0, count: 0 }
    byReason.set(w.reason, { cost: r.cost + w.cost, count: r.count + 1 })
    const n = byName.get(w.name) ?? { cost: 0, count: 0 }
    byName.set(w.name, { cost: n.cost + w.cost, count: n.count + 1 })
  }
  return {
    total: inRange.reduce((s, w) => s + w.cost, 0),
    count: inRange.length,
    byReason: [...byReason.entries()].map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.cost - a.cost),
    top: [...byName.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.cost - a.cost).slice(0, 5),
  }
}

/** Sum per måned (YYYY-MM) for de siste `months` månedene, eldste først. */
export function monthlyTotals<T>(items: T[], dateOf: (t: T) => string, valueOf: (t: T) => number, months = 6, now = new Date()): { month: string; total: number }[] {
  const keys: string[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const sums = new Map(keys.map((k) => [k, 0]))
  for (const t of items) {
    const k = dateOf(t).slice(0, 7)
    if (sums.has(k)) sums.set(k, (sums.get(k) ?? 0) + valueOf(t))
  }
  return keys.map((month) => ({ month, total: sums.get(month) ?? 0 }))
}
