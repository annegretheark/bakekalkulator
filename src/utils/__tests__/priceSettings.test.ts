import { describe, expect, it } from 'vitest'
import { defaultPriceSettings } from '../../lib/defaults'
import { withCustomerType } from '../priceSettings'
import { calculatePrice } from '../electricity'

const base = defaultPriceSettings('NO1') // bedrift som standard

describe('bytte av kundetype (felles for kalkulator og strømpriser)', () => {
  it('bedrift → privat slår på strømstøtte', () => {
    const p = withCustomerType({ ...base, subsidy: { ...base.subsidy, enabled: false } }, 'privat')
    expect(p.customerType).toBe('privat')
    expect(p.subsidy.enabled).toBe(true)
  })

  it('privat med Norgespris → bedrift går over til spotpris', () => {
    const p = withCustomerType({ ...base, customerType: 'privat', mode: 'norgespris' }, 'bedrift')
    expect(p.mode).toBe('spot')
  })

  it('mva i NO4: 0 % for privat, 25 % for bedrift', () => {
    const no4 = defaultPriceSettings('NO4')
    expect(withCustomerType(no4, 'privat').vatRatePercent).toBe(0)
    expect(withCustomerType({ ...no4, customerType: 'privat', vatRatePercent: 0 }, 'bedrift').vatRatePercent).toBe(25)
  })

  it('mva utenfor NO4 endres ikke', () => {
    expect(withCustomerType({ ...base, vatRatePercent: 25 }, 'privat').vatRatePercent).toBe(25)
  })

  it('samme kundetype gir uendret oppsett', () => {
    expect(withCustomerType(base, 'bedrift')).toBe(base)
  })

  it('prisen endrer seg ved bytte (spot 2 kr, eksempel)', () => {
    const bedrift = { ...base, officialRates: 'manual' as const }
    const privat = withCustomerType(bedrift, 'privat')
    expect(calculatePrice(bedrift, 2).total).not.toBeCloseTo(calculatePrice(privat, 2).total)
  })
})
