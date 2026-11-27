import type { BusinessType, RecipeCategory, YieldUnit } from '../types'
import type { AppRoute } from '../hooks/useRoute'

export const BUSINESS_TYPE_NAMES: Record<BusinessType, string> = {
  privat: 'Privatperson',
  bakeri: 'Bakeri',
  restaurant: 'Restaurant',
  kafe: 'Kafé',
  catering: 'Catering',
  kantine: 'Kantine',
  matprodusent: 'Matprodusent',
  annet: 'Annet',
}

/** Virksomhetstyper en bedrift kan velge (privatperson er en egen kontotype). */
export const BUSINESS_ORG_TYPES: Exclude<BusinessType, 'privat'>[] = ['bakeri', 'restaurant', 'kafe', 'catering', 'kantine', 'matprodusent', 'annet']

export const RECIPE_CATEGORY_NAMES: Record<RecipeCategory, string> = {
  brod_bakervarer: 'Brød og bakervarer',
  frokost: 'Frokost',
  lunsj: 'Lunsj',
  forretter: 'Forretter',
  hovedretter: 'Hovedretter',
  supper: 'Supper',
  salater: 'Salater',
  pizza: 'Pizza',
  desserter: 'Desserter',
  drikke: 'Drikke',
  sauser: 'Sauser',
  tilbehor: 'Tilbehør',
  catering: 'Catering',
  annet: 'Annet',
}

/** Ord, meny og standardvalg som tilpasses virksomhetstypen. */
export interface BusinessProfile {
  greeting: string
  overviewText: string
  calculatorName: string
  historyName: string
  /** Hva én produksjon kalles i tekster («baking» eller «produksjon»). */
  productionWord: string
  productionWordPlural: string
  defaultCategory: RecipeCategory
  defaultYieldUnit: YieldUnit
  /** Sammenligning med butikkpris er mest relevant for hjemmebakere og bakerier. */
  showStorePrice: boolean
  /** Snarveier i menyen nederst på mobil (i tillegg til «Mer»). */
  mobileTabs: AppRoute[]
  /** Menypunkter som skjules (privatpersoner trenger ikke personalkostnader og menyer). */
  hiddenRoutes: AppRoute[]
}

const BAKERY: BusinessProfile = {
  greeting: 'God dag, baker!',
  overviewText: 'Her er status for bakingen din og strømprisen akkurat nå.',
  calculatorName: 'Bakekalkulator',
  historyName: 'Bakehistorikk',
  productionWord: 'baking',
  productionWordPlural: 'bakinger',
  defaultCategory: 'brod_bakervarer',
  defaultYieldUnit: 'stk',
  showStorePrice: true,
  mobileTabs: ['oversikt', 'kalkulator', 'oppskrifter', 'skann'],
  hiddenRoutes: [],
}

const FOOD: BusinessProfile = {
  greeting: 'God dag!',
  overviewText: 'Her er status for produksjonen og strømprisen akkurat nå.',
  calculatorName: 'Kalkulator',
  historyName: 'Produksjonshistorikk',
  productionWord: 'produksjon',
  productionWordPlural: 'produksjoner',
  defaultCategory: 'hovedretter',
  defaultYieldUnit: 'porsjoner',
  showStorePrice: false,
  mobileTabs: ['oversikt', 'oppskrifter', 'menyer', 'skann'],
  hiddenRoutes: [],
}

export const BUSINESS_PROFILES: Record<BusinessType, BusinessProfile> = {
  privat: { ...BAKERY, greeting: 'God dag!', overviewText: 'Her er status for matlagingen og strømprisen akkurat nå.', hiddenRoutes: ['kostnader', 'menyer', 'leverandorer', 'lager', 'svinn', 'dashboard'] },
  bakeri: BAKERY,
  restaurant: FOOD,
  kafe: { ...FOOD, defaultCategory: 'lunsj' },
  catering: { ...FOOD, defaultCategory: 'catering' },
  kantine: { ...FOOD, defaultCategory: 'lunsj' },
  matprodusent: { ...FOOD, defaultYieldUnit: 'stk', defaultCategory: 'annet' },
  annet: { ...FOOD, defaultCategory: 'annet' },
}

export function businessProfile(t: BusinessType | null | undefined): BusinessProfile {
  return BUSINESS_PROFILES[t ?? 'privat'] ?? BUSINESS_PROFILES.privat
}

export function isBusinessType(v: unknown): v is BusinessType {
  return typeof v === 'string' && v in BUSINESS_TYPE_NAMES
}

/** Enhetsord for antall: «stk» eller «porsjoner» (entall: «porsjon»). */
export function yieldWord(unit: YieldUnit, count = 2): string {
  if (unit === 'porsjoner') return count === 1 ? 'porsjon' : 'porsjoner'
  return 'stk'
}
