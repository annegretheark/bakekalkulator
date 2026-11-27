import { describe, expect, it } from 'vitest'
import { calculateEnergy, ovenKwh, ovenLoadProfile } from '../energy'
import { defaultEnergyInput } from '../../lib/defaults'
import type { EnergyInput, Oven } from '../../types'

const base = (): EnergyInput => ({
  ...defaultEnergyInput(),
  ovenWatt: 38000, preheatMinutes: 30, preheatPowerPercent: 100,
  bakeMinutes: 60, bakePowerPercent: 50, rounds: 2,
  mixerWatt: 0, otherEquipment: [],
})
const oven = (o: Partial<Oven>): Oven => ({
  id: 'x', name: 'Ovn', watt: 19000, preheatMinutes: 30, preheatPowerPercent: 100,
  bakeMinutes: 60, bakePowerPercent: 50, rounds: 2, ...o,
})

describe('flere ovner', () => {
  it('én ovn gir samme resultat som før (38 kW)', () => {
    const r = calculateEnergy(base())
    // 38 × 0,5 t × 100 % = 19 kWh forvarming; 38 × 1 t × 50 % × 2 = 38 kWh steking
    expect(r.parts[0].kwh).toBeCloseTo(19)
    expect(r.parts[1].kwh).toBeCloseTo(38)
    expect(r.estimatedKwh).toBeCloseTo(57)
  })

  it('summerer forvarming og steking for alle ovner (38 + 19 + 10 kW)', () => {
    const input = { ...base(), extraOvens: [oven({ id: 'a', watt: 19000 }), oven({ id: 'b', watt: 10000 })] }
    const r = calculateEnergy(input)
    expect(r.parts[0].kwh).toBeCloseTo(33.5) // 67 kW × 0,5 t
    expect(r.parts[1].kwh).toBeCloseTo(67) // 67 kW × 1 t × 50 % × 2
    expect(r.parts[1].label).toBe('Steking (3 ovner)')
    expect(ovenKwh(input)).toBeCloseTo(100.5)
  })

  it('ovn med 0 omganger regner bare forvarming', () => {
    const input = { ...base(), extraOvens: [oven({ rounds: 0 })] }
    expect(calculateEnergy(input).parts[1].kwh).toBeCloseTo(38)
    expect(calculateEnergy(input).parts[0].kwh).toBeCloseTo(28.5)
  })

  it('samlet effektprofil legger sammen ovner som går samtidig', () => {
    const input = { ...base(), extraOvens: [oven({ watt: 10000, preheatMinutes: 10, bakeMinutes: 20, rounds: 1 })] }
    const p = ovenLoadProfile(input)
    expect(p[0]).toEqual({ minutes: 10, kw: 48 }) // begge forvarmer
    expect(p[1].minutes).toBe(20)
    expect(p[1].kw).toBeCloseTo(38 + 5) // ovn 1 forvarmer, ovn 2 steker på 50 %
    expect(p.reduce((s, x) => s + x.minutes, 0)).toBe(150)
    expect(ovenKwh(input)).toBeCloseTo(calculateEnergy(input).parts[0].kwh + calculateEnergy(input).parts[1].kwh)
  })

  it('eldre data uten extraOvens fungerer', () => {
    const input = base()
    delete input.extraOvens
    expect(calculateEnergy(input).estimatedKwh).toBeCloseTo(57)
  })
})
