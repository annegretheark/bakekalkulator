import type { EnergyInput, EquipmentItem, EquipmentUse, Oven } from '../types'

const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0)

/** Ny bruk av en registrert enhet i en oppskrift eller kalkulasjon. */
export function equipmentUseFrom(item: EquipmentItem, id: string, runs = 1): EquipmentUse {
  return {
    id,
    equipmentId: item.id,
    name: item.name,
    watt: item.watt,
    preheatMinutes: item.preheatMinutes,
    preheatPowerPercent: item.preheatPowerPercent,
    powerPercent: item.powerPercent,
    measuredKwh: item.measuredKwh,
    minutes: item.minutes,
    runs,
    preheat: item.preheatMinutes > 0,
  }
}

/**
 * Oppdaterer kopierte verdier (navn, effekt, forvarming, målt forbruk) fra registeret.
 * Tid og omganger per bruk beholdes. Slettet utstyr beholder siste kjente verdier.
 */
export function syncEnergyWithRegister(energy: EnergyInput, items: EquipmentItem[]): EnergyInput {
  const uses = energy.equipmentUses
  if (!uses?.length) return energy
  const byId = new Map(items.map((i) => [i.id, i]))
  let changed = false
  const next = uses.map((u) => {
    const it = byId.get(u.equipmentId)
    if (!it) return u
    const synced: EquipmentUse = {
      ...u, name: it.name, watt: it.watt, preheatMinutes: it.preheatMinutes,
      preheatPowerPercent: it.preheatPowerPercent, powerPercent: it.powerPercent, measuredKwh: it.measuredKwh,
    }
    if (JSON.stringify(synced) !== JSON.stringify(u)) changed = true
    return synced
  })
  return changed ? { ...energy, equipmentUses: next } : energy
}

/**
 * Gjør utstyrsbruk om til «ovner» for energiberegning og effektprofil.
 * Samme enhet brukt flere ganger i samme produksjon slås sammen, slik at
 * forvarmingen bare regnes én gang og ingenting telles dobbelt.
 * Målt forbruk (kWh per omgang, inkl. forvarming) erstatter anslaget.
 */
export function equipmentUsesAsOvens(uses: EquipmentUse[] | undefined): Oven[] {
  if (!uses?.length) return []
  const groups = new Map<string, EquipmentUse[]>()
  for (const u of uses) {
    const key = u.equipmentId || u.id
    groups.set(key, [...(groups.get(key) ?? []), u])
  }
  const ovens: Oven[] = []
  for (const [key, list] of groups) {
    const first = list[0]
    const runMinutes = list.reduce((s, u) => s + pos(u.minutes) * Math.max(0, Math.floor(pos(u.runs))), 0)
    const preheat = list.some((u) => u.preheat) ? pos(first.preheatMinutes) : 0
    const measured = pos(first.measuredKwh ?? 0)
    if (measured > 0) {
      const runs = list.reduce((s, u) => s + Math.max(0, Math.floor(pos(u.runs))), 0)
      const kwh = measured * runs
      const minutes = Math.max(1, preheat + runMinutes)
      ovens.push({
        id: key, name: first.name, watt: kwh > 0 ? (kwh / (minutes / 60)) * 1000 : 0,
        preheatMinutes: 0, preheatPowerPercent: 100, bakeMinutes: minutes, bakePowerPercent: 100, rounds: 1,
      })
      continue
    }
    ovens.push({
      id: key, name: first.name, watt: pos(first.watt),
      preheatMinutes: preheat, preheatPowerPercent: first.preheatPowerPercent,
      bakeMinutes: runMinutes, bakePowerPercent: first.powerPercent, rounds: runMinutes > 0 ? 1 : 0,
    })
  }
  return ovens
}

/** Omganger som trengs for et antall, gitt kapasitet per omgang. */
export function runsNeeded(count: number, outputPerRun: number | null): number {
  if (!outputPerRun || outputPerRun <= 0 || !(count > 0)) return 1
  return Math.max(1, Math.ceil(count / outputPerRun))
}

/** Kontinuerlig utstyr: strømforbruk per døgn i kWh. */
export function continuousDailyKwh(item: EquipmentItem): number {
  if (!item.continuous) return 0
  return (pos(item.watt) / 1000) * Math.min(24, pos(item.hoursPerDay)) * (pos(item.powerPercent) / 100)
}

/** Kontinuerlig utstyr: strømforbruk per måned (30 dager) i kWh. */
export function continuousMonthlyKwh(items: EquipmentItem[]): number {
  return items.reduce((s, i) => s + continuousDailyKwh(i) * 30, 0)
}

/** Estimert forbruk for én normal produksjon med enheten (kWh). */
export function runKwh(item: EquipmentItem): number {
  if (item.continuous) return 0
  if (item.measuredKwh && item.measuredKwh > 0) return item.measuredKwh
  const kw = pos(item.watt) / 1000
  return kw * (pos(item.preheatMinutes) / 60) * (pos(item.preheatPowerPercent) / 100)
    + kw * (pos(item.minutes) / 60) * (pos(item.powerPercent) / 100)
}
