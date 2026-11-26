import type { CustomerType, PriceSettings } from '../types'

/**
 * Bytter kundetype og justerer det som følger med, likt overalt i appen:
 *  - Bedrift kan ikke ha Norgespris → spotpris.
 *  - Privat får strømstøtte automatisk (husholdninger).
 *  - Mva-fritaket for strøm i Nord-Norge (NO4) gjelder kun husholdninger.
 */
export function withCustomerType(ps: PriceSettings, customerType: CustomerType): PriceSettings {
  if (ps.customerType === customerType) return ps
  return {
    ...ps,
    customerType,
    mode: customerType === 'bedrift' && ps.mode === 'norgespris' ? 'spot' : ps.mode,
    subsidy: customerType === 'privat' ? { ...ps.subsidy, enabled: true } : ps.subsidy,
    vatRatePercent: ps.area === 'NO4' ? (customerType === 'bedrift' ? 25 : 0) : ps.vatRatePercent,
  }
}
