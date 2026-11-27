import type { EnergyInput, EnergyResult, LoadSegment, Oven } from '../types'
import { equipmentUsesAsOvens } from './equipment'

const clampNonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0)

/** Energi i kWh = effekt (W) / 1000 × tid (timer) × effektfaktor. */
export function energyKwh(watt: number, minutes: number, powerPercent = 100): number {
  return (clampNonNeg(watt) / 1000) * (clampNonNeg(minutes) / 60) * (clampNonNeg(powerPercent) / 100)
}

/**
 * Beregner strømforbruk for hele bakeprosessen.
 * Forvarming beregnes én gang. Steking ganges med antall omganger.
 */
const roundsOf = (n: number) => Math.max(0, Math.floor(clampNonNeg(n)))

/** Bruker beregningen utstyr fra registeret (i stedet for manuelle ovnsfelt)? */
export function usesRegister(input: EnergyInput): boolean {
  return input.energySource === 'equipment'
}

/**
 * Alle ovner: hovedovnen (feltene i EnergyInput) og eventuelle ekstra ovner.
 * Med utstyr fra registeret er det bare registerutstyret som teller.
 */
export function allOvens(input: EnergyInput): Oven[] {
  if (usesRegister(input)) return equipmentUsesAsOvens(input.equipmentUses)
  const main: Oven = {
    id: 'main', name: 'Ovn 1', watt: input.ovenWatt,
    preheatMinutes: input.preheatMinutes, preheatPowerPercent: input.preheatPowerPercent,
    bakeMinutes: input.bakeMinutes, bakePowerPercent: input.bakePowerPercent, rounds: input.rounds,
  }
  return [main, ...(Array.isArray(input.extraOvens) ? input.extraOvens : [])]
}

function calculateRegisterEnergy(input: EnergyInput): EnergyResult {
  const ovens = allOvens(input)
  const parts = ovens.map((o) => ({
    key: `eq:${o.id}`,
    label: o.name || 'Utstyr',
    kwh: energyKwh(o.watt, o.preheatMinutes, o.preheatPowerPercent) + energyKwh(o.watt, o.bakeMinutes, o.bakePowerPercent) * roundsOf(o.rounds),
  }))
  const estimatedKwh = parts.reduce((s, p) => s + p.kwh, 0)
  const measured = input.useMeasured && clampNonNeg(input.measuredKwh) > 0
  return { parts, estimatedKwh, totalKwh: measured ? clampNonNeg(input.measuredKwh) : estimatedKwh, measured }
}

export function calculateEnergy(input: EnergyInput): EnergyResult {
  if (usesRegister(input)) return calculateRegisterEnergy(input)
  const ovens = allOvens(input)
  const rounds = roundsOf(input.rounds)
  const preheat = ovens.reduce((s, o) => s + energyKwh(o.watt, o.preheatMinutes, o.preheatPowerPercent), 0)
  const bake = ovens.reduce((s, o) => s + energyKwh(o.watt, o.bakeMinutes, o.bakePowerPercent) * roundsOf(o.rounds), 0)
  const mixer = energyKwh(input.mixerWatt, input.mixerMinutes, input.mixerPowerPercent)
  const other = input.otherEquipment.reduce(
    (sum, e) => sum + energyKwh(e.watt, e.minutes, e.powerFactorPercent),
    0,
  )
  const estimatedKwh = preheat + bake + mixer + other
  const measured = input.useMeasured && clampNonNeg(input.measuredKwh) > 0
  return {
    parts: [
      { key: 'preheat', label: ovens.length > 1 ? `Forvarming (${ovens.length} ovner)` : 'Forvarming', kwh: preheat },
      { key: 'bake', label: ovens.length > 1 ? `Steking (${ovens.length} ovner)` : `Steking (${rounds} omg.)`, kwh: bake },
      { key: 'mixer', label: 'Kjøkkenmaskin', kwh: mixer },
      { key: 'other', label: 'Annet utstyr', kwh: other },
    ],
    estimatedKwh,
    totalKwh: measured ? clampNonNeg(input.measuredKwh) : estimatedKwh,
    measured,
  }
}

function singleOvenProfile(o: Oven): LoadSegment[] {
  const kw = clampNonNeg(o.watt) / 1000
  const rounds = roundsOf(o.rounds)
  const segs: LoadSegment[] = []
  if (o.preheatMinutes > 0) {
    segs.push({ minutes: o.preheatMinutes, kw: (kw * clampNonNeg(o.preheatPowerPercent)) / 100 })
  }
  if (o.bakeMinutes > 0 && rounds > 0) {
    segs.push({ minutes: o.bakeMinutes * rounds, kw: (kw * clampNonNeg(o.bakePowerPercent)) / 100 })
  }
  return segs
}

/**
 * Samlet effektprofil for alle ovner. Ovnene antas å starte samtidig, så effektene
 * legges sammen der de overlapper i tid.
 */
export function ovenLoadProfile(input: EnergyInput): LoadSegment[] {
  const profiles = allOvens(input).map(singleOvenProfile).filter((p) => p.length > 0)
  if (profiles.length <= 1) return profiles[0] ?? []
  // Bruddpunkter der minst én ovn endrer effekt
  const points = new Set<number>([0])
  for (const p of profiles) {
    let t = 0
    for (const seg of p) { t += seg.minutes; points.add(t) }
  }
  const sorted = [...points].sort((a, b) => a - b)
  const kwAt = (p: LoadSegment[], t: number) => {
    let start = 0
    for (const seg of p) {
      if (t < start + seg.minutes) return seg.kw
      start += seg.minutes
    }
    return 0
  }
  const segs: LoadSegment[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const minutes = sorted[i + 1] - sorted[i]
    const kw = profiles.reduce((s, p) => s + kwAt(p, sorted[i]), 0)
    const last = segs[segs.length - 1]
    if (last && Math.abs(last.kw - kw) < 1e-9) last.minutes += minutes
    else segs.push({ minutes, kw })
  }
  return segs
}

export function ovenKwh(input: EnergyInput): number {
  return ovenLoadProfile(input).reduce((s, seg) => s + (seg.kw * seg.minutes) / 60, 0)
}
