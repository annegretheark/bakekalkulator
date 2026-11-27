import type { EquipmentItem, EquipmentType } from '../types'

export const EQUIPMENT_TYPE_NAMES: Record<EquipmentType, string> = {
  stekeovn: 'Stekeovn',
  varmluftsovn: 'Varmluftsovn',
  bakerovn: 'Bakerovn',
  pizzaovn: 'Pizzaovn',
  komfyr: 'Komfyr',
  induksjonstopp: 'Induksjonstopp',
  frityr: 'Frityr',
  grill: 'Grill',
  mikrobolgeovn: 'Mikrobølgeovn',
  eltemaskin: 'Eltemaskin',
  kjokkenmaskin: 'Kjøkkenmaskin',
  oppvaskmaskin: 'Oppvaskmaskin',
  kjoleskap: 'Kjøleskap',
  fryser: 'Fryser',
  ventilasjon: 'Ventilasjonsanlegg',
  annet: 'Annet elektrisk utstyr',
}

type Template = Pick<EquipmentItem, 'watt' | 'preheatMinutes' | 'preheatPowerPercent' | 'powerPercent' | 'minutes' | 'continuous' | 'hoursPerDay'>

/**
 * Ferdige maler med ANSLAG for typisk utstyr. Verdiene er grove gjennomsnitt og
 * merkes som anslag i registeret til kunden har lagt inn effekten fra typeskiltet.
 */
export const EQUIPMENT_TEMPLATES: Record<EquipmentType, Template> = {
  stekeovn: { watt: 3000, preheatMinutes: 15, preheatPowerPercent: 100, powerPercent: 50, minutes: 45, continuous: false, hoursPerDay: 24 },
  varmluftsovn: { watt: 6000, preheatMinutes: 15, preheatPowerPercent: 100, powerPercent: 50, minutes: 45, continuous: false, hoursPerDay: 24 },
  bakerovn: { watt: 12000, preheatMinutes: 45, preheatPowerPercent: 100, powerPercent: 45, minutes: 40, continuous: false, hoursPerDay: 24 },
  pizzaovn: { watt: 8000, preheatMinutes: 40, preheatPowerPercent: 100, powerPercent: 50, minutes: 60, continuous: false, hoursPerDay: 24 },
  komfyr: { watt: 2000, preheatMinutes: 0, preheatPowerPercent: 100, powerPercent: 60, minutes: 30, continuous: false, hoursPerDay: 24 },
  induksjonstopp: { watt: 3500, preheatMinutes: 0, preheatPowerPercent: 100, powerPercent: 60, minutes: 30, continuous: false, hoursPerDay: 24 },
  frityr: { watt: 9000, preheatMinutes: 15, preheatPowerPercent: 100, powerPercent: 40, minutes: 60, continuous: false, hoursPerDay: 24 },
  grill: { watt: 4000, preheatMinutes: 15, preheatPowerPercent: 100, powerPercent: 50, minutes: 60, continuous: false, hoursPerDay: 24 },
  mikrobolgeovn: { watt: 1000, preheatMinutes: 0, preheatPowerPercent: 100, powerPercent: 100, minutes: 5, continuous: false, hoursPerDay: 24 },
  eltemaskin: { watt: 1500, preheatMinutes: 0, preheatPowerPercent: 100, powerPercent: 70, minutes: 15, continuous: false, hoursPerDay: 24 },
  kjokkenmaskin: { watt: 1000, preheatMinutes: 0, preheatPowerPercent: 100, powerPercent: 60, minutes: 10, continuous: false, hoursPerDay: 24 },
  oppvaskmaskin: { watt: 7000, preheatMinutes: 20, preheatPowerPercent: 100, powerPercent: 60, minutes: 60, continuous: false, hoursPerDay: 24 },
  kjoleskap: { watt: 300, preheatMinutes: 0, preheatPowerPercent: 100, powerPercent: 35, minutes: 0, continuous: true, hoursPerDay: 24 },
  fryser: { watt: 400, preheatMinutes: 0, preheatPowerPercent: 100, powerPercent: 40, minutes: 0, continuous: true, hoursPerDay: 24 },
  ventilasjon: { watt: 1500, preheatMinutes: 0, preheatPowerPercent: 100, powerPercent: 80, minutes: 0, continuous: true, hoursPerDay: 10 },
  annet: { watt: 1000, preheatMinutes: 0, preheatPowerPercent: 100, powerPercent: 60, minutes: 30, continuous: false, hoursPerDay: 24 },
}

/** Ny enhet fra mal. Merkes som anslag til kunden har kontrollert verdiene. */
export function equipmentFromTemplate(type: EquipmentType, id: string): EquipmentItem {
  return {
    id,
    name: EQUIPMENT_TYPE_NAMES[type],
    type,
    manufacturer: '',
    model: '',
    measuredKwh: null,
    outputPerRun: null,
    isEstimate: true,
    comment: '',
    ...EQUIPMENT_TEMPLATES[type],
  }
}
