import type { EnergyInput, EnergyResult, LoadSegment } from '../types'

const clampNonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0)

/** Energi i kWh = effekt (W) / 1000 × tid (timer) × effektfaktor. */
export function energyKwh(watt: number, minutes: number, powerPercent = 100): number {
  return (clampNonNeg(watt) / 1000) * (clampNonNeg(minutes) / 60) * (clampNonNeg(powerPercent) / 100)
}

/**
 * Beregner strømforbruk for hele bakeprosessen.
 * Forvarming beregnes én gang. Steking ganges med antall omganger.
 */
export function calculateEnergy(input: EnergyInput): EnergyResult {
  const rounds = Math.max(0, Math.floor(clampNonNeg(input.rounds)))
  const preheat = energyKwh(input.ovenWatt, input.preheatMinutes, input.preheatPowerPercent)
  const bake = energyKwh(input.ovenWatt, input.bakeMinutes, input.bakePowerPercent) * rounds
  const mixer = energyKwh(input.mixerWatt, input.mixerMinutes, input.mixerPowerPercent)
  const other = input.otherEquipment.reduce(
    (sum, e) => sum + energyKwh(e.watt, e.minutes, e.powerFactorPercent),
    0,
  )
  const estimatedKwh = preheat + bake + mixer + other
  const measured = input.useMeasured && clampNonNeg(input.measuredKwh) > 0
  return {
    parts: [
      { key: 'preheat', label: 'Forvarming', kwh: preheat },
      { key: 'bake', label: `Steking (${rounds} omg.)`, kwh: bake },
      { key: 'mixer', label: 'Kjøkkenmaskin', kwh: mixer },
      { key: 'other', label: 'Annet utstyr', kwh: other },
    ],
    estimatedKwh,
    totalKwh: measured ? clampNonNeg(input.measuredKwh) : estimatedKwh,
    measured,
  }
}

/** Effektprofil for ovnen: forvarming etterfulgt av alle stekeomganger. */
export function ovenLoadProfile(input: EnergyInput): LoadSegment[] {
  const kw = clampNonNeg(input.ovenWatt) / 1000
  const rounds = Math.max(0, Math.floor(clampNonNeg(input.rounds)))
  const segs: LoadSegment[] = []
  if (input.preheatMinutes > 0) {
    segs.push({ minutes: input.preheatMinutes, kw: (kw * clampNonNeg(input.preheatPowerPercent)) / 100 })
  }
  if (input.bakeMinutes > 0 && rounds > 0) {
    segs.push({ minutes: input.bakeMinutes * rounds, kw: (kw * clampNonNeg(input.bakePowerPercent)) / 100 })
  }
  return segs
}

export function ovenKwh(input: EnergyInput): number {
  return ovenLoadProfile(input).reduce((s, seg) => s + (seg.kw * seg.minutes) / 60, 0)
}
