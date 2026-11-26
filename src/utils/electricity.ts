import type { CheapestWindow, LoadSegment, PriceBreakdown, PriceComponent, PriceInterval, PriceMode, PriceSettings } from '../types'

const MS_PER_MIN = 60_000

export function isBusiness(settings: PriceSettings): boolean {
  return settings.customerType === 'bedrift'
}

/** Avtaletypen som faktisk gjelder: bedrifter kan ikke ha Norgespris og faller tilbake til spot. */
export function effectiveMode(settings: PriceSettings): PriceMode {
  return isBusiness(settings) && settings.mode === 'norgespris' ? 'spot' : settings.mode
}

/** Mva som faktisk belastes: 0 for mva-registrert bedrift med fradragsrett. */
export function appliedVatPercent(settings: PriceSettings): number {
  return isBusiness(settings) && settings.vatDeductible ? 0 : Math.max(0, settings.vatRatePercent)
}

/** Strømstøtte gjelder kun husholdninger med spotpris. */
export function subsidyApplies(settings: PriceSettings): boolean {
  return !isBusiness(settings) && effectiveMode(settings) === 'spot' && settings.subsidy.enabled
}

/** Henter beløp eks. mva fra et tillegg – uansett om brukeren har angitt det med eller uten mva. */
export function componentExVat(c: PriceComponent, vatRatePercent: number): number {
  if (!c.enabled || !Number.isFinite(c.krPerKwh)) return 0
  const r = Math.max(0, vatRatePercent) / 100
  return c.includesVat ? c.krPerKwh / (1 + r) : c.krPerKwh
}

/**
 * Bygger opp total strømpris per kWh.
 *
 * Prinsipp for å unngå dobbel beregning:
 *  1. Alle komponenter regnes om til beløp eks. mva.
 *  2. Mva legges på én gang, på summen.
 *  3. Strømstøtte (kun husholdning med spot) trekkes fra til slutt, inkl. mva.
 *  Bedrifter: ingen Norgespris og ingen strømstøtte.
 *  4. Manuell pris brukes som den er – ingen tillegg.
 *  5. Totalprisen kan bli negativ når spotprisen er negativ (ingen nedre grense).
 *
 * @param spotExVat Spotpris eks. mva for intervallet (påkrevd i spot-modus).
 */
export function calculatePrice(settings: PriceSettings, spotExVat: number | null): PriceBreakdown {
  // vatRatePercent brukes til å trekke mva ut av satser oppgitt inkl. mva;
  // r er mva som faktisk legges på (0 når bedriften har fradragsrett).
  const r = appliedVatPercent(settings) / 100
  const notes: string[] = []
  const mode = effectiveMode(settings)
  if (mode !== settings.mode) notes.push('Norgespris gjelder ikke bedrifter – spotpris er brukt.')

  if (mode === 'manuell') {
    const total = Number.isFinite(settings.manualTotalKrPerKwh) ? settings.manualTotalKrPerKwh : 0
    return {
      energy: total, supplierMarkup: 0, gridFee: 0, electricityTax: 0, otherFees: 0, vat: 0, subsidy: 0, total,
      notes: ['Manuell totalpris – nettleie, avgifter og mva antas inkludert.'],
    }
  }

  let energy = 0
  let markup = 0
  if (mode === 'spot') {
    energy = spotExVat ?? 0
    if (spotExVat === null) notes.push('Spotpris mangler for dette tidspunktet.')
    markup = componentExVat(settings.supplierMarkup, settings.vatRatePercent)
  } else if (mode === 'fastpris') {
    energy = componentExVat({ ...settings.fixedPrice, enabled: true }, settings.vatRatePercent)
    markup = componentExVat(settings.supplierMarkup, settings.vatRatePercent)
  } else if (mode === 'norgespris') {
    energy = componentExVat({ ...settings.norgespris, enabled: true }, settings.vatRatePercent)
    notes.push('Norgespris: påslag og strømstøtte er ikke lagt til.')
  }

  const gridFee = componentExVat(settings.gridFee, settings.vatRatePercent)
  const taxIncluded = settings.electricityTax.includedInGridFee
  const electricityTax = taxIncluded ? 0 : componentExVat(settings.electricityTax, settings.vatRatePercent)
  if (taxIncluded && settings.gridFee.enabled) notes.push('Elavgift er inkludert i nettleien og legges ikke til separat.')
  const otherFees = componentExVat(settings.otherFees, settings.vatRatePercent)

  const subtotal = energy + markup + gridFee + electricityTax + otherFees
  const vat = subtotal * r
  if (isBusiness(settings) && settings.vatDeductible) notes.push('Mva-registrert bedrift: mva trekkes fra, kostnaden vises eks. mva.')

  let subsidy = 0
  if (subsidyApplies(settings) && spotExVat !== null) {
    const over = Math.max(0, spotExVat - settings.subsidy.thresholdKrPerKwhExVat)
    // Unngå -0 (vises som «−0,0 øre») når spotprisen er under terskelen eller negativ
    if (over > 0) subsidy = -(over * (Math.min(100, Math.max(0, settings.subsidy.coveragePercent)) / 100) * (1 + r))
  }

  return {
    energy, supplierMarkup: markup, gridFee, electricityTax, otherFees, vat, subsidy,
    total: subtotal + vat + subsidy, // kan være negativ ved negativ spotpris
    notes,
  }
}

export interface PricedInterval {
  start: string
  end: string
  spotNokPerKwh: number
  totalPerKwh: number
}

export function priceIntervals(intervals: PriceInterval[], settings: PriceSettings): PricedInterval[] {
  return intervals.map((i) => ({ ...i, totalPerKwh: calculatePrice(settings, i.spotNokPerKwh).total }))
}

/** Lengde på intervallet i minutter (60 for timespriser, 15 for kvarterspriser). */
export function intervalMinutes(i: { start: string; end: string }): number {
  return (Date.parse(i.end) - Date.parse(i.start)) / MS_PER_MIN
}

/** Finner intervallet som gjelder for et gitt tidspunkt. */
export function intervalAt<T extends { start: string; end: string }>(intervals: T[], at: Date): T | undefined {
  const t = at.getTime()
  return intervals.find((i) => Date.parse(i.start) <= t && t < Date.parse(i.end))
}

/**
 * Kostnad for en effektprofil som starter på `startMs`.
 * Integrerer effekt × pris over alle intervaller profilen overlapper.
 * Returnerer null dersom profilen går utenfor sammenhengende prisdata.
 */
export function profileCost(
  intervals: { start: string; end: string; totalPerKwh: number }[],
  profile: LoadSegment[],
  startMs: number,
): number | null {
  let cost = 0
  let t = startMs
  for (const seg of profile) {
    if (seg.minutes <= 0) continue
    const segEnd = t + seg.minutes * MS_PER_MIN
    let covered = 0
    for (const iv of intervals) {
      const a = Math.max(t, Date.parse(iv.start))
      const b = Math.min(segEnd, Date.parse(iv.end))
      if (b > a) {
        covered += b - a
        cost += seg.kw * ((b - a) / 3_600_000) * iv.totalPerKwh
      }
    }
    if (Math.abs(covered - (segEnd - t)) > 1000) return null
    t = segEnd
  }
  return cost
}

/**
 * Billigste sammenhengende starttidspunkt for hele profilen (forvarming + steking).
 * Kandidater er starten på hvert prisintervall (time eller kvarter) fra og med `notBefore`.
 */
export function findCheapestWindow(
  intervals: { start: string; end: string; totalPerKwh: number }[],
  profile: LoadSegment[],
  notBefore?: Date,
): CheapestWindow | null {
  const totalMin = profile.reduce((s, p) => s + Math.max(0, p.minutes), 0)
  const totalKwh = profile.reduce((s, p) => s + (p.kw * Math.max(0, p.minutes)) / 60, 0)
  if (totalMin <= 0 || intervals.length === 0) return null
  const sorted = [...intervals].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  const minStart = notBefore ? notBefore.getTime() : -Infinity

  let best: CheapestWindow | null = null
  for (const iv of sorted) {
    const s = Date.parse(iv.start)
    if (s < minStart) continue
    const cost = profileCost(sorted, profile, s)
    if (cost === null) continue
    if (!best || cost < best.cost - 1e-9) {
      best = {
        start: iv.start,
        end: new Date(s + totalMin * MS_PER_MIN).toISOString(),
        cost,
        avgPricePerKwh: totalKwh > 0 ? cost / totalKwh : 0,
      }
    }
  }
  return best
}
