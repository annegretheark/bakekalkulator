import { describe, expect, it } from 'vitest'
import { calculateEnergy, ovenKwh, ovenLoadProfile } from '../energy'
import { continuousDailyKwh, continuousMonthlyKwh, equipmentUsesAsOvens, runKwh, runsNeeded, syncEnergyWithRegister, equipmentUseFrom } from '../equipment'
import { equipmentFromTemplate, EQUIPMENT_TEMPLATES } from '../../lib/equipmentTemplates'
import { defaultEnergyInput } from '../../lib/defaults'
import { EQUIPMENT_TYPES, type EnergyInput, type EquipmentItem } from '../../types'

const item = (p: Partial<EquipmentItem> = {}): EquipmentItem => ({
  ...equipmentFromTemplate('bakerovn', 'ovn-1'),
  name: 'Dekkovn', watt: 12000, preheatMinutes: 30, preheatPowerPercent: 100, powerPercent: 50, minutes: 60,
  ...p,
})

const registerEnergy = (uses: EnergyInput['equipmentUses']): EnergyInput => ({
  ...defaultEnergyInput(), energySource: 'equipment', equipmentUses: uses,
})

describe('utstyr fra registeret', () => {
  it('beregner forvarming og drift for én enhet', () => {
    // 12 kW × 0,5 t = 6 kWh forvarming; 12 kW × 1 t × 50 % × 2 omganger = 12 kWh
    const r = calculateEnergy(registerEnergy([equipmentUseFrom(item(), 'u1', 2)]))
    expect(r.estimatedKwh).toBeCloseTo(18)
    expect(r.parts).toHaveLength(1)
    expect(r.parts[0].label).toBe('Dekkovn')
  })

  it('ignorerer manuelle ovnsfelt, så samme ovn ikke regnes to ganger', () => {
    const manual = calculateEnergy({ ...defaultEnergyInput(), ovenWatt: 50000 }).estimatedKwh
    const reg = calculateEnergy({ ...registerEnergy([equipmentUseFrom(item(), 'u1', 1)]), ovenWatt: 50000, mixerWatt: 5000 })
    expect(manual).toBeGreaterThan(30) // 50 kW: 12,5 kWh forvarming + 20,6 kWh steking
    expect(reg.estimatedKwh).toBeCloseTo(12) // 6 + 6
  })

  it('regner forvarming bare én gang når samme enhet er lagt inn flere ganger', () => {
    const a = equipmentUseFrom(item(), 'u1', 1)
    const b = equipmentUseFrom(item(), 'u2', 1)
    const ovens = equipmentUsesAsOvens([a, b])
    expect(ovens).toHaveLength(1)
    // 6 kWh forvarming + 2 × 6 kWh drift
    expect(calculateEnergy(registerEnergy([a, b])).estimatedKwh).toBeCloseTo(18)
  })

  it('summerer flere ulike enheter', () => {
    const mixer = item({ id: 'mix', name: 'Eltemaskin', watt: 1500, preheatMinutes: 0, powerPercent: 70, minutes: 20 })
    const r = calculateEnergy(registerEnergy([equipmentUseFrom(item(), 'u1', 1), equipmentUseFrom(mixer, 'u2', 1)]))
    expect(r.parts).toHaveLength(2)
    expect(r.estimatedKwh).toBeCloseTo(12 + 1.5 * (20 / 60) * 0.7)
  })

  it('bruker målt forbruk per omgang i stedet for anslaget', () => {
    const measured = item({ measuredKwh: 9 })
    const r = calculateEnergy(registerEnergy([equipmentUseFrom(measured, 'u1', 3)]))
    expect(r.estimatedKwh).toBeCloseTo(27)
    expect(ovenKwh(registerEnergy([equipmentUseFrom(measured, 'u1', 3)]))).toBeCloseTo(27)
  })

  it('uten forvarming regnes bare drift', () => {
    const u = { ...equipmentUseFrom(item(), 'u1', 1), preheat: false }
    expect(calculateEnergy(registerEnergy([u])).estimatedKwh).toBeCloseTo(6)
  })

  it('effektprofilen legger sammen enheter som går samtidig', () => {
    const second = item({ id: 'ovn-2', name: 'Ovn 2', watt: 6000, preheatMinutes: 30 })
    const profile = ovenLoadProfile(registerEnergy([equipmentUseFrom(item(), 'u1', 1), equipmentUseFrom(second, 'u2', 1)]))
    expect(profile[0]).toEqual({ minutes: 30, kw: 18 })
    const kwh = profile.reduce((s, p) => s + (p.kw * p.minutes) / 60, 0)
    expect(kwh).toBeCloseTo(calculateEnergy(registerEnergy([equipmentUseFrom(item(), 'u1', 1), equipmentUseFrom(second, 'u2', 1)])).estimatedKwh)
  })

  it('målt totalforbruk for hele produksjonen erstatter fortsatt estimatet', () => {
    const r = calculateEnergy({ ...registerEnergy([equipmentUseFrom(item(), 'u1', 1)]), useMeasured: true, measuredKwh: 5 })
    expect(r.totalKwh).toBe(5)
    expect(r.measured).toBe(true)
  })

  it('tom liste gir null forbruk', () => {
    expect(calculateEnergy(registerEnergy([])).estimatedKwh).toBe(0)
    expect(ovenLoadProfile(registerEnergy([]))).toEqual([])
  })

  it('eldre data uten energySource beregnes som før', () => {
    const e = defaultEnergyInput()
    expect(calculateEnergy({ ...e, equipmentUses: [equipmentUseFrom(item(), 'u1', 1)] }).estimatedKwh)
      .toBeCloseTo(calculateEnergy(e).estimatedKwh)
  })
})

describe('kapasitet og kontinuerlig utstyr', () => {
  it('foreslår antall omganger ut fra kapasitet', () => {
    expect(runsNeeded(100, 40)).toBe(3)
    expect(runsNeeded(40, 40)).toBe(1)
    expect(runsNeeded(10, null)).toBe(1)
  })

  it('beregner døgn- og månedsforbruk for kjøleskap', () => {
    const fridge = equipmentFromTemplate('kjoleskap', 'k') // 300 W, 35 %, 24 t
    expect(continuousDailyKwh(fridge)).toBeCloseTo(0.3 * 24 * 0.35)
    expect(continuousMonthlyKwh([fridge, fridge])).toBeCloseTo(0.3 * 24 * 0.35 * 30 * 2)
    expect(runKwh(fridge)).toBe(0)
  })

  it('anslag per produksjon for vanlig utstyr', () => {
    expect(runKwh(item())).toBeCloseTo(12)
    expect(runKwh(item({ measuredKwh: 4 }))).toBe(4)
  })

  it('alle utstyrstyper har mal, og maler er merket som anslag', () => {
    for (const t of EQUIPMENT_TYPES) {
      expect(EQUIPMENT_TEMPLATES[t].watt).toBeGreaterThan(0)
      expect(equipmentFromTemplate(t, 'x').isEstimate).toBe(true)
    }
    expect(equipmentFromTemplate('fryser', 'x').continuous).toBe(true)
    expect(equipmentFromTemplate('stekeovn', 'x').continuous).toBe(false)
  })
})

describe('synkronisering med registeret', () => {
  it('oppdaterer effekt og navn, men beholder tid og omganger per bruk', () => {
    const use = { ...equipmentUseFrom(item(), 'u1', 3), minutes: 25 }
    const synced = syncEnergyWithRegister(registerEnergy([use]), [item({ watt: 15000, name: 'Ny ovn' })])
    expect(synced.equipmentUses![0]).toMatchObject({ watt: 15000, name: 'Ny ovn', minutes: 25, runs: 3 })
  })

  it('beholder siste kjente verdier når enheten er slettet', () => {
    const e = registerEnergy([equipmentUseFrom(item(), 'u1', 1)])
    expect(syncEnergyWithRegister(e, [])).toBe(e)
  })
})
