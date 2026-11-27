// Sentrale datamodeller for Rett i lomma – Matkalkulator.
// Alle modeller er rene data (serialiserbare) slik at de kan lagres i
// localStorage nå og i PostgreSQL/Supabase senere.

export type Id = string

export type BakeType = 'brod' | 'rundstykker' | 'kake' | 'pizza' | 'boller' | 'annet'

export const BAKE_TYPES: BakeType[] = ['brod', 'rundstykker', 'kake', 'pizza', 'boller', 'annet']

// ---------- Virksomhet ----------
export type BusinessType = 'privat' | 'bakeri' | 'restaurant' | 'kafe' | 'catering' | 'kantine' | 'matprodusent' | 'annet'
export const BUSINESS_TYPES: BusinessType[] = ['privat', 'bakeri', 'restaurant', 'kafe', 'catering', 'kantine', 'matprodusent', 'annet']

// ---------- Oppskriftskategorier ----------
export type RecipeCategory =
  | 'brod_bakervarer' | 'frokost' | 'lunsj' | 'forretter' | 'hovedretter' | 'supper' | 'salater'
  | 'pizza' | 'desserter' | 'drikke' | 'sauser' | 'tilbehor' | 'catering' | 'annet'
export const RECIPE_CATEGORIES: RecipeCategory[] = [
  'brod_bakervarer', 'frokost', 'lunsj', 'forretter', 'hovedretter', 'supper', 'salater',
  'pizza', 'desserter', 'drikke', 'sauser', 'tilbehor', 'catering', 'annet',
]

/** Hva oppskriften gir: stykk (brød, boller) eller porsjoner (matretter). */
export type YieldUnit = 'stk' | 'porsjoner'

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
  /**
   * 'auto': Norgespris, strømstøtte og elavgift hentes fra gjeldende offentlige
   * satser for datoen. Utløpte satser brukes ikke. 'manual': brukerens egne verdier.
   */
  officialRates: 'auto' | 'manual'
}

/** Offentlig sats med gyldighetsperiode (speiler tabellen electricity_tariffs). */
export interface Tariff {
  id?: string
  code: string
  description: string
  value: number
  unit: string
  area: PriceArea | null
  customerType: CustomerType | null
  validFrom: string // YYYY-MM-DD
  validTo: string | null
  sourceUrl: string
  /** Dato kilden sist ble kontrollert. null = ikke kontrollert → brukes ikke automatisk. */
  verifiedAt: string | null
  notes?: string | null
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

// ---------- Utstyrsregister ----------
export type EquipmentType =
  | 'stekeovn' | 'varmluftsovn' | 'bakerovn' | 'pizzaovn' | 'komfyr' | 'induksjonstopp' | 'frityr' | 'grill'
  | 'mikrobolgeovn' | 'eltemaskin' | 'kjokkenmaskin' | 'oppvaskmaskin' | 'kjoleskap' | 'fryser' | 'ventilasjon' | 'annet'
export const EQUIPMENT_TYPES: EquipmentType[] = [
  'stekeovn', 'varmluftsovn', 'bakerovn', 'pizzaovn', 'komfyr', 'induksjonstopp', 'frityr', 'grill',
  'mikrobolgeovn', 'eltemaskin', 'kjokkenmaskin', 'oppvaskmaskin', 'kjoleskap', 'fryser', 'ventilasjon', 'annet',
]

/** En registrert enhet i utstyrsregisteret (tabellen equipment). */
export interface EquipmentItem {
  id: Id
  name: string
  type: EquipmentType
  manufacturer: string
  model: string
  watt: number
  preheatMinutes: number
  preheatPowerPercent: number
  /** Effektandel under normal drift (termostat, delvis last). */
  powerPercent: number
  /** Normal brukstid per produksjon (min). */
  minutes: number
  /** Målt forbruk per produksjon i kWh, inkl. forvarming. Erstatter anslaget. */
  measuredKwh: number | null
  /** Antall produkter eller porsjoner per produksjon (kapasitet). */
  outputPerRun: number | null
  /** Går hele tiden (kjøleskap, fryser, ventilasjon): felles driftskostnad, ikke per oppskrift. */
  continuous: boolean
  hoursPerDay: number
  /** Verdiene er anslag fra en mal og ikke kontrollert av kunden. */
  isEstimate: boolean
  comment: string
}

/**
 * Registrert utstyr brukt i en oppskrift eller kalkulasjon. Verdiene kopieres fra
 * registeret (og oppdateres derfra ved innlasting), så oppskriften kan beregnes
 * også om enheten senere slettes.
 */
export interface EquipmentUse {
  id: Id
  equipmentId: Id
  name: string
  watt: number
  preheatMinutes: number
  preheatPowerPercent: number
  powerPercent: number
  measuredKwh: number | null
  /** Driftstid per omgang (min). */
  minutes: number
  /** Antall omganger. Forvarming regnes én gang per enhet. */
  runs: number
  /** Forvarm enheten (gjelder bare utstyr med forvarmingstid). */
  preheat: boolean
}

/** En ekstra ovn som brukes samtidig med hovedovnen. */
export interface Oven {
  id: Id
  name: string
  watt: number
  preheatMinutes: number
  preheatPowerPercent: number
  bakeMinutes: number
  bakePowerPercent: number
  rounds: number
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
  /** Ekstra ovner (hovedovnen er feltene over). Mangler i eldre lagrede data. */
  extraOvens?: Oven[]
  /**
   * 'manual': ovn og kjøkkenmaskin fra feltene over (som før).
   * 'equipment': bare utstyr fra registeret (equipmentUses). Feltene over brukes da
   * ikke, så samme ovn ikke regnes to ganger. Mangler i eldre data = 'manual'.
   */
  energySource?: 'manual' | 'equipment'
  equipmentUses?: EquipmentUse[]
  useMeasured: boolean
  measuredKwh: number
}

export interface EnergyPart {
  /** 'preheat' | 'bake' | 'mixer' | 'other', eller 'eq:<id>' for utstyr fra registeret */
  key: string
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
  category: RecipeCategory
  yieldCount: number
  yieldUnit: YieldUnit
  /** Aktiv tilberedningstid (min), utenom heving og steking. */
  prepMinutes: number
  /** Ferdig vekt for hele oppskriften i gram. Gir kostnad per kilo. */
  finishedWeightG: number | null
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
  /** Detaljer fra beregningen (ingredienslinjer, prisgrunnlag) – lagres uendret. */
  snapshot?: Record<string, unknown>
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
export type Plan = 'free' | 'plus' | 'pro'

export interface AppSettings {
  locale: string // 'nb-NO'
  currency: string // 'NOK'
  bakesPerMonth: number
  price: PriceSettings
  plan: Plan
  /** Virksomhetstype (tilpasser meny og ord). I skyen lagres den på organisasjonen. */
  businessType: BusinessType
}

export interface AppData {
  version: number
  settings: AppSettings
  ingredients: Ingredient[]
  recipes: Recipe[]
  history: BakeLog[]
  equipment: EquipmentItem[]
}
