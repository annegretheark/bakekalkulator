import { describe, expect, it } from 'vitest'
import type { PriceSettings, Tariff } from '../../types'
import { defaultPriceSettings } from '../../lib/defaults'
import { LOCAL_TARIFFS } from '../../lib/tariffs'
import { activeTariff, applyTariffs, isTariffActive } from '../tariffs'
import { calculatePrice } from '../electricity'

const privat = (o: Partial<PriceSettings> = {}): PriceSettings => ({ ...defaultPriceSettings('NO1'), customerType: 'privat', ...o })

describe('datostyrte strømprissatser', () => {
  it('sats er gyldig kun innenfor perioden', () => {
    const np = LOCAL_TARIFFS.find((t) => t.code === 'norgespris')!
    expect(isTariffActive(np, '2026-11-26')).toBe(true)
    expect(isTariffActive(np, '2025-09-30')).toBe(false)
    expect(isTariffActive(np, '2027-01-01')).toBe(false)
  })

  it('activeTariff returnerer null for utløpt sats', () => {
    const ctx = { area: 'NO1' as const, customerType: 'privat' as const }
    expect(activeTariff(LOCAL_TARIFFS, 'norgespris', { ...ctx, date: '2026-12-31' })?.value).toBe(0.4)
    expect(activeTariff(LOCAL_TARIFFS, 'norgespris', { ...ctx, date: '2027-01-01' })).toBeNull()
  })

  it('mest spesifikke og nyeste sats vinner', () => {
    const base: Tariff = { code: 'x', description: 'x', value: 1, unit: 'kr', area: null, customerType: null, validFrom: '2026-01-01', validTo: null, sourceUrl: 'https://x', verifiedAt: '2026-01-01' }
    const list: Tariff[] = [base, { ...base, value: 2, area: 'NO4' }, { ...base, value: 3, validFrom: '2026-06-01' }]
    expect(activeTariff(list, 'x', { date: '2026-07-01', area: 'NO4', customerType: 'privat' })?.value).toBe(2)
    expect(activeTariff(list, 'x', { date: '2026-07-01', area: 'NO1', customerType: 'privat' })?.value).toBe(3)
  })

  it('gjeldende satser legges inn i auto-modus', () => {
    const r = applyTariffs(privat({ mode: 'norgespris', norgespris: { enabled: true, krPerKwh: 9, includesVat: false } }), LOCAL_TARIFFS, '2026-11-26')
    expect(r.settings.norgespris.krPerKwh).toBe(0.4)
    expect(r.warnings).toEqual([])
    expect(r.used.map((t) => t.code)).toContain('norgespris')
  })

  it('utløpt Norgespris brukes ikke – faller tilbake til manuell pris med advarsel', () => {
    const s = privat({ mode: 'norgespris', manualTotalKrPerKwh: 1.5 })
    const r = applyTariffs(s, LOCAL_TARIFFS, '2027-01-05')
    expect(r.settings.mode).toBe('manuell')
    expect(r.warnings[0]).toMatch(/utløp 31\.12\.2026/)
    expect(calculatePrice(r.settings, 2).total).toBe(1.5)
  })

  it('utløpt strømstøtte trekkes ikke fra', () => {
    const r = applyTariffs(privat({ mode: 'spot' }), LOCAL_TARIFFS, '2027-01-05')
    expect(r.settings.subsidy.enabled).toBe(false)
    expect(r.warnings.join(' ')).toMatch(/Strømstøtte/)
    expect(calculatePrice(r.settings, 2).subsidy).toBe(0)
  })

  it('gyldig strømstøtte brukes med sats fra tabellen', () => {
    const r = applyTariffs(privat({ subsidy: { enabled: true, thresholdKrPerKwhExVat: 5, coveragePercent: 10 } }), LOCAL_TARIFFS, '2026-11-26')
    expect(r.settings.subsidy).toEqual({ enabled: true, thresholdKrPerKwhExVat: 0.77, coveragePercent: 90 })
  })

  it('utløpt elavgift legges ikke til når den ikke er inkludert i nettleien', () => {
    const s = privat({ electricityTax: { enabled: true, krPerKwh: 0.0713, includesVat: false, includedInGridFee: false } })
    expect(applyTariffs(s, LOCAL_TARIFFS, '2026-11-26').settings.electricityTax.enabled).toBe(true)
    const later = applyTariffs(s, LOCAL_TARIFFS, '2027-02-01')
    expect(later.settings.electricityTax.enabled).toBe(false)
    expect(later.warnings.join(' ')).toMatch(/Elavgift/)
  })

  it('manuelle satser endres aldri automatisk', () => {
    const s = privat({ mode: 'norgespris', officialRates: 'manual', norgespris: { enabled: true, krPerKwh: 0.45, includesVat: false } })
    const r = applyTariffs(s, LOCAL_TARIFFS, '2027-01-05')
    expect(r.settings).toBe(s)
    expect(r.warnings).toEqual([])
  })

  it('bedrift påvirkes ikke av husholdningssatser', () => {
    const r = applyTariffs({ ...defaultPriceSettings('NO1'), customerType: 'bedrift' }, LOCAL_TARIFFS, '2027-01-05')
    expect(r.warnings).toEqual([])
  })
})
