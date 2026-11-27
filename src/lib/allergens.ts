import type { AllergenCode, AllergenMark, AllergenStatus } from '../types'
import { ALLERGEN_CODES } from '../types'

/** Navn slik de står i matinformasjonsforskriften (vedlegg II), forkortet. */
export const ALLERGEN_NAMES: Record<AllergenCode, string> = {
  gluten: 'Glutenholdige kornslag',
  skalldyr: 'Skalldyr',
  egg: 'Egg',
  fisk: 'Fisk',
  peanotter: 'Peanøtter',
  soya: 'Soya',
  melk: 'Melk',
  notter: 'Nøtter',
  selleri: 'Selleri',
  sennep: 'Sennep',
  sesam: 'Sesam',
  sulfitt: 'Svoveldioksid og sulfitter',
  lupin: 'Lupin',
  blotdyr: 'Bløtdyr',
}

/** Kort navn til tabeller og menyer. */
export const ALLERGEN_SHORT: Record<AllergenCode, string> = {
  gluten: 'Gluten', skalldyr: 'Skalldyr', egg: 'Egg', fisk: 'Fisk', peanotter: 'Peanøtter', soya: 'Soya', melk: 'Melk',
  notter: 'Nøtter', selleri: 'Selleri', sennep: 'Sennep', sesam: 'Sesam', sulfitt: 'Sulfitt', lupin: 'Lupin', blotdyr: 'Bløtdyr',
}

export const ALLERGEN_MARK_NAMES: Record<AllergenMark, string> = {
  ja: 'Inneholder',
  spor: 'Kan inneholde spor',
  nei: 'Inneholder ikke',
}

export const ALLERGEN_STATUS_NAMES: Record<AllergenStatus, string> = {
  inneholder: 'Inneholder',
  spor: 'Kan inneholde spor',
  krysskontakt: 'Risiko for krysskontakt',
  ukjent: 'Ukjent',
  fri: 'Inneholder ikke',
}

/** Rangering: den alvorligste statusen vinner når ingredienser slås sammen. */
const RANK: Record<AllergenStatus, number> = { inneholder: 4, spor: 3, krysskontakt: 2, ukjent: 1, fri: 0 }

export function worstStatus(a: AllergenStatus, b: AllergenStatus): AllergenStatus {
  return RANK[a] >= RANK[b] ? a : b
}

export function markToStatus(mark: AllergenMark | undefined): AllergenStatus {
  if (mark === 'ja') return 'inneholder'
  if (mark === 'spor') return 'spor'
  if (mark === 'nei') return 'fri'
  // Manglende opplysning er aldri det samme som «inneholder ikke»
  return 'ukjent'
}

export type AllergenProfile = Record<AllergenCode, AllergenStatus>

export function emptyProfile(status: AllergenStatus = 'fri'): AllergenProfile {
  return Object.fromEntries(ALLERGEN_CODES.map((c) => [c, status])) as AllergenProfile
}

export function mergeProfiles(a: AllergenProfile, b: AllergenProfile): AllergenProfile {
  return Object.fromEntries(ALLERGEN_CODES.map((c) => [c, worstStatus(a[c], b[c])])) as AllergenProfile
}

/** Allergener som skal merkes (inneholder) i en profil. */
export function containedAllergens(p: AllergenProfile): AllergenCode[] {
  return ALLERGEN_CODES.filter((c) => p[c] === 'inneholder')
}

export function isAllergenCode(v: unknown): v is AllergenCode {
  return typeof v === 'string' && (ALLERGEN_CODES as string[]).includes(v)
}

/** Rensker et allergenkart fra lagring (ukjente nøkler og verdier fjernes). */
export function cleanAllergenMap(v: unknown): Partial<Record<AllergenCode, AllergenMark>> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Partial<Record<AllergenCode, AllergenMark>> = {}
  for (const [k, m] of Object.entries(v as Record<string, unknown>)) {
    if (isAllergenCode(k) && (m === 'ja' || m === 'spor' || m === 'nei')) out[k] = m
  }
  return out
}
