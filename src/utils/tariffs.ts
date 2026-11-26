import type { PriceSettings, Tariff } from '../types'
import { TARIFF_CODES } from '../lib/tariffs'

export interface TariffContext {
  date: string // YYYY-MM-DD
  area: PriceSettings['area']
  customerType: PriceSettings['customerType']
}

export function isTariffActive(t: Tariff, date: string): boolean {
  return t.validFrom <= date && (t.validTo === null || t.validTo >= date)
}

/** Satsen kan brukes automatisk: gyldig på datoen OG kilden er kontrollert. */
export function isTariffUsable(t: Tariff, date: string): boolean {
  return isTariffActive(t, date) && !!t.verifiedAt
}

/**
 * Gjeldende sats for en kode på en dato. Mest spesifikke treff vinner
 * (område/kundetype foran generelle), deretter nyeste gyldig-fra.
 * Returnerer null hvis ingen sats gjelder – utløpte og ikke-verifiserte satser brukes aldri.
 */
export function activeTariff(tariffs: Tariff[], code: string, ctx: TariffContext): Tariff | null {
  const candidates = tariffs.filter((t) =>
    t.code === code &&
    isTariffUsable(t, ctx.date) &&
    (t.area === null || t.area === ctx.area) &&
    (t.customerType === null || t.customerType === ctx.customerType))
  if (candidates.length === 0) return null
  const score = (t: Tariff) => (t.area ? 2 : 0) + (t.customerType ? 1 : 0)
  return [...candidates].sort((a, b) => score(b) - score(a) || b.validFrom.localeCompare(a.validFrom))[0]
}

/** Siste kjente sats (også utløpt) – kun til visning, aldri til beregning. */
export function latestTariff(tariffs: Tariff[], code: string): Tariff | null {
  const c = tariffs.filter((t) => t.code === code)
  return c.length ? [...c].sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] : null
}

export interface AppliedTariffs {
  settings: PriceSettings
  warnings: string[]
  used: Tariff[]
}

function fmtDate(d: string) {
  return d.split('-').reverse().join('.')
}

/**
 * Legger gjeldende offentlige satser inn i prisoppsettet (kun i 'auto'-modus).
 * Mangler eller er en sats utløpt, brukes den IKKE automatisk:
 *  - Norgespris → beregningen bruker manuell pris, med advarsel.
 *  - Strømstøtte → trekkes ikke fra, med advarsel.
 *  - Elavgift (når den ikke er inkludert i nettleien) → legges ikke til, med advarsel.
 */
export function applyTariffs(settings: PriceSettings, tariffs: Tariff[], date: string): AppliedTariffs {
  if (settings.officialRates === 'manual') return { settings, warnings: [], used: [] }

  const ctx: TariffContext = { date, area: settings.area, customerType: settings.customerType }
  const s: PriceSettings = structuredClone(settings)
  const warnings: string[] = []
  const used: Tariff[] = []
  const expiredNote = (code: string, label: string) => {
    const last = latestTariff(tariffs, code)
    return last?.validTo && last.validTo < date
      ? `${label}-satsen utløp ${fmtDate(last.validTo)} og brukes ikke automatisk.`
      : `Ingen gjeldende ${label.toLowerCase()}-sats for ${fmtDate(date)}.`
  }

  // Norgespris
  if (s.customerType === 'privat') {
    const np = activeTariff(tariffs, TARIFF_CODES.norgespris, ctx)
    if (np) {
      s.norgespris = { enabled: true, krPerKwh: np.value, includesVat: false }
      if (s.mode === 'norgespris') used.push(np)
    } else if (s.mode === 'norgespris') {
      s.mode = 'manuell'
      warnings.push(`${expiredNote(TARIFF_CODES.norgespris, 'Norgespris')} Manuell pris er brukt – legg inn ny sats eller velg manuelle satser.`)
    }
  }

  // Strømstøtte
  if (s.customerType === 'privat' && s.subsidy.enabled) {
    const th = activeTariff(tariffs, TARIFF_CODES.subsidyThreshold, ctx)
    const cov = activeTariff(tariffs, TARIFF_CODES.subsidyCoverage, ctx)
    if (th && cov) {
      s.subsidy = { enabled: true, thresholdKrPerKwhExVat: th.value, coveragePercent: cov.value }
      if (s.mode === 'spot') used.push(th, cov)
    } else {
      s.subsidy = { ...s.subsidy, enabled: false }
      if (s.mode === 'spot') warnings.push(`${expiredNote(TARIFF_CODES.subsidyThreshold, 'Strømstøtte')} Strømstøtte er ikke trukket fra.`)
    }
  }

  // Elavgift
  if (s.electricityTax.enabled && !s.electricityTax.includedInGridFee) {
    const tax = activeTariff(tariffs, TARIFF_CODES.electricityTax, ctx)
    if (tax) {
      s.electricityTax = { ...s.electricityTax, krPerKwh: tax.value, includesVat: false }
      used.push(tax)
    } else {
      s.electricityTax = { ...s.electricityTax, enabled: false }
      warnings.push(`${expiredNote(TARIFF_CODES.electricityTax, 'Elavgift')} Elavgift er ikke lagt til.`)
    }
  }

  return { settings: s, warnings, used }
}
