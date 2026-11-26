// Oversetting mellom databaserader (snake_case) og appens modeller (camelCase).
// Rene funksjoner – testes isolert.
import type { AppData, AppSettings, BakeLog, EnergyInput, Ingredient, PriceSettings, Recipe, RecipeIngredient, Tariff } from '../../types'
import { defaultEnergyInput, defaultPriceSettings, defaultSettings } from '../../lib/defaults'
import { DATA_VERSION } from '../../lib/seed'
import type { Plan } from '../../types'

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

export interface IngredientRow {
  id: string
  organization_id: string
  local_id?: string | null
  name: string
  category: string
  package_size: number | string
  unit: Ingredient['unit']
  price: number | string
  store: string
  price_updated: string
}

export interface RecipeIngredientRow {
  id: string
  ingredient_id: string | null
  position: number
  amount: number | string
  unit: Ingredient['unit']
}

export interface RecipeRow {
  id: string
  organization_id: string
  name: string
  type: Recipe['type']
  yield_count: number
  steps: string[] | null
  rise_minutes: number
  bake_minutes: number
  store_price_per_item: number | string
  notes: string
  energy: Partial<EnergyInput> | null
  created_at: string
  updated_at: string
  recipe_ingredients?: RecipeIngredientRow[]
}

export interface HistoryRow {
  id: string
  organization_id: string
  baked_at: string
  recipe_id: string | null
  recipe_name: string
  type: BakeLog['type']
  count: number
  kwh: number | string
  price_per_kwh: number | string
  electricity_cost: number | string
  ingredient_cost: number | string
  total_cost: number | string
  cost_per_item: number | string
  store_price_per_item: number | string
  revenue: number | string | null
  profit: number | string | null
  note: string
  snapshot?: Record<string, unknown>
}

export interface TariffRow {
  id: string
  code: string
  description: string
  value: number | string
  unit: string
  area: Tariff['area']
  customer_type: Tariff['customerType']
  valid_from: string
  valid_to: string | null
  source_url: string
  verified_at: string | null
  notes: string | null
}

export const ingredientFromRow = (r: IngredientRow): Ingredient => ({
  id: r.id,
  name: r.name,
  category: r.category ?? '',
  packageSize: num(r.package_size, 1),
  unit: r.unit,
  price: num(r.price),
  store: r.store ?? '',
  priceUpdated: r.price_updated,
})

/** Argument til RPC-en save_ingredient (organisasjonen sendes separat). */
export const ingredientToRpc = (i: Ingredient) => ({
  id: i.id,
  name: i.name.trim(),
  category: i.category ?? '',
  package_size: i.packageSize,
  unit: i.unit,
  price: i.price,
  store: i.store ?? '',
  price_updated: i.priceUpdated || new Date().toISOString().slice(0, 10),
})

export const energyFromJson = (e: Partial<EnergyInput> | null | undefined): EnergyInput => ({
  ...defaultEnergyInput(),
  ...(e ?? {}),
  otherEquipment: Array.isArray(e?.otherEquipment) ? e.otherEquipment : [],
})

export const recipeFromRow = (r: RecipeRow): Recipe => ({
  id: r.id,
  name: r.name,
  type: r.type,
  yieldCount: r.yield_count,
  ingredients: [...(r.recipe_ingredients ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((l): RecipeIngredient => ({ id: l.id, ingredientId: l.ingredient_id ?? '', amount: num(l.amount), unit: l.unit })),
  steps: r.steps ?? [],
  riseMinutes: r.rise_minutes,
  bakeMinutes: r.bake_minutes,
  storePricePerItem: num(r.store_price_per_item),
  notes: r.notes ?? '',
  energy: energyFromJson(r.energy),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

/** Argumenter til RPC-en save_recipe. */
export const recipeToRpc = (r: Recipe) => ({
  recipe: {
    id: r.id,
    name: r.name.trim(),
    type: r.type,
    yield_count: Math.max(1, Math.round(r.yieldCount)),
    steps: r.steps.filter((s) => s.trim()),
    rise_minutes: Math.round(r.riseMinutes),
    bake_minutes: Math.round(r.bakeMinutes),
    store_price_per_item: r.storePricePerItem,
    notes: r.notes,
    energy: r.energy,
  },
  lines: r.ingredients.map((l) => ({ id: l.id, ingredient_id: l.ingredientId || null, amount: l.amount, unit: l.unit })),
})

const optNum = (v: number | string | null) => (v === null || v === undefined ? null : num(v))

export const historyFromRow = (r: HistoryRow): BakeLog => ({
  id: r.id,
  date: r.baked_at,
  recipeId: r.recipe_id,
  recipeName: r.recipe_name,
  type: r.type,
  count: r.count,
  kwh: num(r.kwh),
  pricePerKwh: num(r.price_per_kwh),
  electricityCost: num(r.electricity_cost),
  ingredientCost: num(r.ingredient_cost),
  totalCost: num(r.total_cost),
  costPerItem: num(r.cost_per_item),
  storePricePerItem: num(r.store_price_per_item),
  revenue: optNum(r.revenue),
  profit: optNum(r.profit),
  note: r.note ?? '',
})

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d

/** Øyeblikksbilde: alle beløp kopieres inn – senere prisendringer påvirker dem ikke. */
export const historyToRow = (l: BakeLog, organizationId: string, snapshot: Record<string, unknown> = {}) => ({
  id: l.id,
  organization_id: organizationId,
  baked_at: l.date,
  recipe_id: l.recipeId,
  recipe_name: l.recipeName.trim() || 'Bakst',
  type: l.type,
  count: Math.max(1, Math.round(l.count)),
  kwh: round(Math.max(0, l.kwh), 4),
  // Strømpris, strømkostnad og totalkostnad kan være negative (negativ spotpris)
  price_per_kwh: round(l.pricePerKwh, 6),
  electricity_cost: round(l.electricityCost, 2),
  ingredient_cost: round(Math.max(0, l.ingredientCost), 2),
  total_cost: round(l.totalCost, 2),
  cost_per_item: round(l.costPerItem, 4),
  store_price_per_item: round(Math.max(0, l.storePricePerItem), 2),
  revenue: l.revenue === null ? null : round(l.revenue, 2),
  profit: l.profit === null ? null : round(l.profit, 2),
  note: l.note ?? '',
  snapshot,
})

export const tariffFromRow = (r: TariffRow): Tariff => ({
  id: r.id,
  code: r.code,
  description: r.description,
  value: num(r.value),
  unit: r.unit,
  area: r.area,
  customerType: r.customer_type,
  validFrom: r.valid_from,
  validTo: r.valid_to,
  sourceUrl: r.source_url,
  verifiedAt: r.verified_at,
  notes: r.notes,
})

export const tariffToRpc = (t: Tariff) => ({
  id: t.id ?? null,
  code: t.code,
  description: t.description,
  value: t.value,
  unit: t.unit,
  area: t.area ?? '',
  customer_type: t.customerType ?? '',
  valid_from: t.validFrom,
  valid_to: t.validTo ?? '',
  source_url: t.sourceUrl,
  verified_at: t.verifiedAt ?? '',
  notes: t.notes ?? '',
})

/** Fletter lagret strømoppsett med standardverdier (nye felt får verdi). */
export function priceSettingsFromJson(json: Partial<PriceSettings> | null | undefined): PriceSettings {
  const base = defaultPriceSettings((json?.area as PriceSettings['area']) ?? 'NO1')
  return { ...base, ...(json ?? {}) } as PriceSettings
}

export interface UserSettingsRow {
  locale: string
  currency: string
  bakes_per_month: number | string
}

export function settingsFromRows(user: UserSettingsRow | null, price: Partial<PriceSettings> | null, plan: Plan): AppSettings {
  const def = defaultSettings()
  return {
    locale: user?.locale ?? def.locale,
    currency: user?.currency ?? def.currency,
    bakesPerMonth: user ? num(user.bakes_per_month, def.bakesPerMonth) : def.bakesPerMonth,
    price: priceSettingsFromJson(price),
    plan,
  }
}

export function buildAppData(parts: {
  user: UserSettingsRow | null
  price: Partial<PriceSettings> | null
  plan: Plan
  ingredients: IngredientRow[]
  recipes: RecipeRow[]
  history: HistoryRow[]
}): AppData {
  return {
    version: DATA_VERSION,
    settings: settingsFromRows(parts.user, parts.price, parts.plan),
    ingredients: parts.ingredients.map(ingredientFromRow),
    recipes: parts.recipes.map(recipeFromRow),
    history: parts.history.map(historyFromRow),
  }
}

/** Gjør databasefeil (f.eks. PLAN_LIMIT fra triggere) lesbare for brukeren. */
export function dbErrorMessage(err: { message?: string; code?: string } | null | undefined): string {
  const m = err?.message ?? 'Ukjent feil.'
  const prefixed = m.match(/^(PLAN_LIMIT|PLAN_FEATURE|FORBIDDEN|HISTORY_IMMUTABLE|IMMUTABLE|REAUTH_REQUIRED|NOT_AUTHENTICATED|LAST_OWNER|LAST_MEMBER|BUSINESS_ONLY|USER_NOT_FOUND|CONFIRMATION_REQUIRED|INVALID|NOT_FOUND)(?::\s*(.*))?$/)
  if (prefixed) {
    if (prefixed[2]) return prefixed[2]
    if (prefixed[1] === 'FORBIDDEN') return 'Du har ikke tilgang til dette.'
    if (prefixed[1] === 'NOT_FOUND') return 'Fant ikke det du lette etter.'
  }
  if (err?.code === '42501' || /row-level security|permission denied/i.test(m)) return 'Du har ikke tilgang til å gjøre dette.'
  if (err?.code === '23P01' || /electricity_tariffs_no_overlap/.test(m)) return 'Satsen overlapper en eksisterende sats med samme kode, område og kundetype. Avslutt den gamle satsen (gyldig til) først.'
  if (err?.code === '23503') return 'Dataene henger sammen med noe som ikke finnes eller tilhører en annen.'
  if (err?.code === '23514') return 'Ugyldig verdi.'
  if (/fetch|network/i.test(m)) return 'Fikk ikke kontakt med serveren.'
  return m
}
