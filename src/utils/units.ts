import type { Unit, UnitDimension } from '../types'

const UNIT_INFO: Record<Unit, { dimension: UnitDimension; toBase: number }> = {
  g: { dimension: 'mass', toBase: 1 },
  kg: { dimension: 'mass', toBase: 1000 },
  ml: { dimension: 'volume', toBase: 1 },
  dl: { dimension: 'volume', toBase: 100 },
  l: { dimension: 'volume', toBase: 1000 },
  stk: { dimension: 'count', toBase: 1 },
}

export function unitDimension(unit: Unit): UnitDimension {
  return UNIT_INFO[unit].dimension
}

export function isCompatible(a: Unit, b: Unit): boolean {
  return unitDimension(a) === unitDimension(b)
}

/**
 * Konverterer mellom enheter innen samme dimensjon.
 * Returnerer null ved volum ↔ vekt (krever kjent tetthet) eller stk ↔ annet.
 */
export function convert(amount: number, from: Unit, to: Unit): number | null {
  if (!isCompatible(from, to)) return null
  return (amount * UNIT_INFO[from].toBase) / UNIT_INFO[to].toBase
}
