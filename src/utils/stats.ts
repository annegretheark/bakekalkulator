import type { BakeLog } from '../types'

export type StatPeriod = 'week' | 'month' | 'year' | 'all'

export interface HistoryStats {
  bakes: number
  items: number
  kwh: number
  electricityCost: number
  ingredientCost: number
  totalCost: number
  avgCostPerItem: number | null
  storeValue: number
  savings: number
  revenue: number
  profit: number
}

/** Startpunkt for perioden (uke starter mandag, norsk standard). */
export function periodStart(period: StatPeriod, now = new Date()): Date | null {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === 'week') {
    const day = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - day)
    return d
  }
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
  if (period === 'year') return new Date(now.getFullYear(), 0, 1)
  return null
}

export function filterByPeriod(logs: BakeLog[], period: StatPeriod, now = new Date()): BakeLog[] {
  const start = periodStart(period, now)
  if (!start) return logs
  return logs.filter((l) => new Date(l.date) >= start)
}

export function summarize(logs: BakeLog[]): HistoryStats {
  const s = logs.reduce(
    (a, l) => {
      a.items += l.count
      a.kwh += l.kwh
      a.electricityCost += l.electricityCost
      a.ingredientCost += l.ingredientCost
      a.totalCost += l.totalCost
      a.storeValue += l.storePricePerItem * l.count
      a.revenue += l.revenue ?? 0
      a.profit += l.profit ?? 0
      return a
    },
    { items: 0, kwh: 0, electricityCost: 0, ingredientCost: 0, totalCost: 0, storeValue: 0, revenue: 0, profit: 0 },
  )
  // Besparelse beregnes kun for bakinger med registrert butikkpris
  const savings = logs.filter((l) => l.storePricePerItem > 0).reduce((a, l) => a + (l.storePricePerItem * l.count - l.totalCost), 0)
  return { ...s, bakes: logs.length, avgCostPerItem: s.items > 0 ? s.totalCost / s.items : null, savings }
}
