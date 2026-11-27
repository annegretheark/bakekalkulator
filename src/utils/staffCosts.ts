import type { CostSettings, EquipmentItem, LaborLine, StaffRole } from '../types'
import { continuousMonthlyKwh } from './equipment'

export interface HourlyCostBreakdown {
  wage: number
  holidayPay: number
  pension: number
  employerTax: number
  other: number
  total: number
}

const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0)

/**
 * Timekostnad for en rolle.
 * Detaljert: feriepenger og pensjon regnes av timelønn, arbeidsgiveravgift av
 * lønn + feriepenger + pensjon, andre kostnader av timelønn.
 * Ferdig: kundens egen timekostnad brukes uendret.
 */
export function hourlyCost(role: StaffRole): HourlyCostBreakdown {
  if (role.mode === 'ferdig') {
    const total = pos(role.fixedHourlyCost)
    return { wage: total, holidayPay: 0, pension: 0, employerTax: 0, other: 0, total }
  }
  const wage = pos(role.hourlyWage)
  const holidayPay = wage * pos(role.holidayPayPercent) / 100
  const pension = wage * pos(role.pensionPercent) / 100
  const employerTax = (wage + holidayPay + pension) * pos(role.employerTaxPercent) / 100
  const other = wage * pos(role.otherPercent) / 100
  return { wage, holidayPay, pension, employerTax, other, total: wage + holidayPay + pension + employerTax + other }
}

export interface LaborCostLine {
  lineId: string
  roleName: string
  hours: number
  cost: number
  missingRole: boolean
}

/** Personalkostnad for hele oppskriften (alle arbeidslinjer). */
export function laborCost(lines: LaborLine[], roles: StaffRole[]): { lines: LaborCostLine[]; hours: number; cost: number } {
  const byId = new Map(roles.map((r) => [r.id, r]))
  const out = lines.map((l): LaborCostLine => {
    const role = byId.get(l.roleId)
    const hours = pos(l.people) * pos(l.minutes) / 60
    return { lineId: l.id, roleName: role?.name ?? 'Ukjent rolle', hours, cost: role ? hours * hourlyCost(role).total : 0, missingRole: !role }
  })
  return { lines: out, hours: out.reduce((s, l) => s + l.hours, 0), cost: out.reduce((s, l) => s + l.cost, 0) }
}

export interface OverheadResult {
  fixedPerMonth: number
  equipmentKwhPerMonth: number
  equipmentPerMonth: number
  totalPerMonth: number
  /** null når antall enheter per måned ikke er satt. */
  perUnit: number | null
}

/** Faste driftskostnader per måned fordelt på stk/porsjoner per måned. */
export function overhead(costs: CostSettings, equipment: EquipmentItem[], pricePerKwh: number): OverheadResult {
  const fixedPerMonth = costs.operatingCosts.reduce((s, c) => s + pos(c.amountPerMonth), 0)
  const equipmentKwhPerMonth = costs.includeContinuousEquipment ? continuousMonthlyKwh(equipment) : 0
  const equipmentPerMonth = equipmentKwhPerMonth * (Number.isFinite(pricePerKwh) ? Math.max(0, pricePerKwh) : 0)
  const totalPerMonth = fixedPerMonth + equipmentPerMonth
  return {
    fixedPerMonth, equipmentKwhPerMonth, equipmentPerMonth, totalPerMonth,
    perUnit: costs.unitsPerMonth > 0 ? totalPerMonth / costs.unitsPerMonth : null,
  }
}
