// Sentrale datamodeller for Rett i lomma – Bakekalkulator.
// Alle modeller er rene data (serialiserbare) slik at de kan lagres i
// localStorage nå og i PostgreSQL/Supabase senere.

export type Id = string

export type BakeType = 'brod' | 'rundstykker' | 'kake' | 'pizza' | 'boller' | 'annet'

export const BAKE_TYPES: BakeType[] = ['brod', 'rundstykker', 'kake', 'pizza', 'boller', 'annet']

// ---------- Enheter ----------
export type Unit = 'g' | 'kg' | 'ml' | 'dl' | 'l' | 'stk'
export type UnitDimension = 'mass' | 'volume' | 'count'
export const UNITS: Unit[] = ['g', 'kg', 'ml', 'dl', 'l', 'stk']

// ---------- Strøm ----------
export type PriceArea = 'NO1' | 'NO2' | 'NO3' | 'NO4' | 'NO5'
export const PRICE_AREAS: PriceArea[] = ['NO1', 'NO2', 'NO3', 'NO4', 'NO5']

export type PriceMode = 'spot' | 'norgespris' | 'fastpris' | 'manuell'

/** Bedrifter har ikke Norgespris eller strømstøtte for husholdninger. */
export type CustomerType = 'privat' | 'bedrift'

/** Ett prisintervall fra API-et (time eller kvarter). Pris eks. mva. */
export interface PriceInterval {
  start: string // ISO
  end: string // ISO
  spotNokPerKwh: number // eks. mva, slik API-et leverer
}

/** Et tillegg som brukeren selv angir, med eget mva-flagg for å unngå dobbel mva. */
export interface PriceComponent {
  enabled: boolean
  krPerKwh: number
  includesVat: boolean
}

export interface PriceSettings {
  area: PriceArea
  customerType: CustomerType
  mode: PriceMode
  vatRatePercent: number // 25 som standard, 0 i deler av Nord-Norge
  /** Bedrift: mva-registrert og trekker fra inngående mva → kostnad regnes eks. mva. */
  vatDeductible: boolean
  norgespris: PriceComponent // pris per kWh i Norgespris-avtalen
  fixedPrice: PriceComponent // fastprisavtale
  manualTotalKrPerKwh: number // alt inkludert – ingen tillegg legges på
  supplierMarkup: PriceComponent // påslag fra strømleverandør
  gridFee: PriceComponent // variabelt energiledd i nettleien
  electricityTax: PriceComponent & { includedInGridFee: boolean }
  otherFees: PriceComponent
  subsidy: {
    enabled: boolean
    thresholdKrPerKwhExVat: number
    coveragePercent: number
  }
}

/** Oppbygging av strømpris per kWh. Alle beløp inkl. mva der mva gjelder. */
export interface PriceBreakdown {
  energy: number
  supplierMarkup: number
  gridFee: number
  electricityTax: number
  otherFees: number
  vat: number
  subsidy: number // negativt eller 0
  total: number
  notes: string[]
}

// ---------- Bakekalkulator ----------
export interface Equipment {
  id: Id
  name: string
  watt: number
  minutes: number
  powerFactorPercent: number
}

export interface EnergyInput {
  ovenWatt: number
  temperatureC: number
  preheatMinutes: number
  preheatPowerPercent: number
  bakeMinutes: number
  bakePowerPercent: number
  rounds: number
  mixerWatt: number
  mixerMinutes: number
  mixerPowerPercent: number
  otherEquipment: Equipment[]
  useMeasured: boolean
  measuredKwh: number
}

export interface EnergyPart {
  key: 'preheat' | 'bake' | 'mixer' | 'other'
  label: string
  kwh: number
}

export interface EnergyResult {
  parts: EnergyPart[]
  totalKwh: number
  estimatedKwh: number
  measured: boolean
}

/** Effektprofil i tid (brukes for å finne billigste tidspunkt). */
export interface LoadSegment {
  minutes: number
  kw: number
}

export interface CheapestWindow {
  start: string
  end: string
  cost: number
  avgPricePerKwh: number
}

// ---------- Ingredienser og oppskrifter ----------
export interface Ingredient {
  id: Id
  name: string
  category: string
  packageSize: number
  unit: Unit
  price: number
  store: string
  priceUpdated: string // ISO-dato
}

export interface RecipeIngredient {
  id: Id
  ingredientId: Id
  amount: number
  unit: Unit
}

export interface Recipe {
  id: Id
  name: string
  type: BakeType
  yieldCount: number
  ingredients: RecipeIngredient[]
  steps: string[]
  riseMinutes: number
  bakeMinutes: number
  storePricePerItem: number
  notes: string
  energy: EnergyInput
  createdAt: string
  updatedAt: string
}

export interface IngredientCostLine {
  recipeIngredientId: Id
  name: string
  amount: number
  unit: Unit
  cost: number | null // null = kan ikke beregnes (ukjent/inkompatibel enhet)
  error?: string
}

// ---------- Historikk ----------
/** Et øyeblikksbilde – kopierte verdier, påvirkes ikke av senere prisendringer. */
export interface BakeLog {
  id: Id
  date: string
  recipeId: Id | null
  recipeName: string
  type: BakeType
  count: number
  kwh: number
  pricePerKwh: number
  electricityCost: number
  ingredientCost: number
  totalCost: number
  costPerItem: number
  storePricePerItem: number
  revenue: number | null
  profit: number | null
  note: string
}

// ---------- Salg ----------
export interface SalesInput {
  units: number
  ingredientCost: number
  electricityCost: number
  packagingPerUnit: number
  laborHours: number
  hourlyRate: number
  transport: number
  wastePercent: number
  otherCosts: number
  pricePerUnit: number
  priceIncludesVat: boolean
  vatRatePercent: number
  targetMarginPercent: number
}

export interface SalesResult {
  totalCost: number
  soldUnits: number
  costPerSoldUnit: number
  priceExVat: number
  revenueExVat: number
  vatAmount: number
  profit: number
  marginPercent: number | null
  markupPercent: number | null
  recommendedPriceExVat: number | null
  recommendedPriceInclVat: number | null
  breakEvenPriceExVat: number | null
}

// ---------- Innstillinger ----------
export type Plan = 'free' | 'pro'

export interface AppSettings {
  locale: string // 'nb-NO'
  currency: string // 'NOK'
  bakesPerMonth: number
  price: PriceSettings
  plan: Plan
}

export interface AppData {
  version: number
  settings: AppSettings
  ingredients: Ingredient[]
  recipes: Recipe[]
  history: BakeLog[]
}
