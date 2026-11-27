// Oversetting mellom databaserader (snake_case) og appens modeller (camelCase).
// Rene funksjoner – testes isolert.
import type { AppData, AppSettings, BakeLog, BusinessType, CostSettings, EnergyInput, EquipmentItem, Id, Ingredient, LaborLine, Menu, MenuItem, PriceEntry, PriceSettings, Recipe, RecipeIngredient, StockMovement, Supplier, Tariff, WasteLog } from '../../types'
import { ALLERGEN_CODES, EQUIPMENT_TYPES, MENU_TYPES, RECIPE_CATEGORIES, WASTE_REASONS } from '../../types'
import { categoryForBakeType, normalizeCostSettings } from '../../utils/portions'
import { cleanAllergenMap } from '../../lib/allergens'
import { isBusinessType } from '../../lib/businessTypes'
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
  allergens?: unknown
  allergens_checked?: boolean | null
  ean?: string | null
  manufacturer?: string | null
  supplier_id?: string | null
  supplier_item_no?: string | null
  vat_percent?: number | string | null
  waste_percent?: number | string | null
  comment?: string | null
  min_stock?: number | string | null
}

export interface RecipeIngredientRow {
  id: string
  ingredient_id: string | null
  sub_recipe_id?: string | null
  position: number
  amount: number | string
  unit: Ingredient['unit']
}

export interface RecipeRow {
  id: string
  organization_id: string
  name: string
  type: Recipe['type']
  category?: string | null
  yield_count: number
  yield_unit?: string | null
  prep_minutes?: number | null
  finished_weight_g?: number | string | null
  steps: string[] | null
  rise_minutes: number
  bake_minutes: number
  store_price_per_item: number | string
  notes: string
  energy: Partial<EnergyInput> | null
  labor?: unknown
  packaging_per_unit?: number | string | null
  cross_contact?: string[] | null
  waste_percent?: number | string | null
  created_at: string
  updated_at: string
  recipe_ingredients?: RecipeIngredientRow[]
}

export interface MenuRow {
  id: string
  organization_id: string
  name: string
  menu_type: string
  description: string | null
  items: unknown
  created_at: string
  updated_at: string
}

export interface EquipmentRow {
  id: string
  organization_id: string
  name: string
  equipment_type?: string | null
  manufacturer?: string | null
  model?: string | null
  watt: number | string
  minutes: number | string
  power_factor_percent: number | string
  preheat_minutes?: number | string | null
  preheat_power_percent?: number | string | null
  measured_kwh?: number | string | null
  output_per_run?: number | null
  continuous?: boolean | null
  hours_per_day?: number | string | null
  is_estimate?: boolean | null
  comment?: string | null
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
  allergens: cleanAllergenMap(r.allergens),
  allergensChecked: r.allergens_checked !== false,
  ean: r.ean ?? '',
  manufacturer: r.manufacturer ?? '',
  supplierId: r.supplier_id ?? null,
  supplierItemNo: r.supplier_item_no ?? '',
  vatPercent: num(r.vat_percent, 15),
  wastePercent: num(r.waste_percent, 0),
  comment: r.comment ?? '',
  minStock: r.min_stock === null || r.min_stock === undefined || r.min_stock === '' ? null : num(r.min_stock),
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
  allergens: cleanAllergenMap(i.allergens),
  allergens_checked: i.allergensChecked !== false,
  ean: /^\d{8,14}$/.test(i.ean ?? '') ? i.ean : '',
  manufacturer: (i.manufacturer ?? '').trim().slice(0, 200),
  supplier_id: i.supplierId || '',
  supplier_item_no: (i.supplierItemNo ?? '').trim().slice(0, 100),
  vat_percent: Math.min(100, Math.max(0, Number.isFinite(i.vatPercent) ? i.vatPercent : 15)),
  waste_percent: Math.min(94.99, Math.max(0, Number.isFinite(i.wastePercent) ? i.wastePercent : 0)),
  comment: (i.comment ?? '').slice(0, 2000),
  min_stock: i.minStock === null || i.minStock === undefined || !Number.isFinite(i.minStock) ? '' : Math.max(0, i.minStock),
})

export const energyFromJson = (e: Partial<EnergyInput> | null | undefined): EnergyInput => ({
  ...defaultEnergyInput(),
  ...(e ?? {}),
  otherEquipment: Array.isArray(e?.otherEquipment) ? e.otherEquipment : [],
  extraOvens: Array.isArray(e?.extraOvens) ? e.extraOvens : [],
})

/** Arbeidslinjer fra JSON. Ugyldige linjer hoppes over. */
export function laborFromJson(v: unknown): LaborLine[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x, i) => ({ id: String(x.id ?? `l${i}`), roleId: String(x.roleId ?? ''), people: num(x.people, 1), minutes: num(x.minutes, 0) }))
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo))

const optPos = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = num(v, 0)
  return n > 0 ? n : null
}

export const recipeFromRow = (r: RecipeRow): Recipe => ({
  id: r.id,
  name: r.name,
  type: r.type,
  category: RECIPE_CATEGORIES.includes(r.category as Recipe['category']) ? (r.category as Recipe['category']) : categoryForBakeType(r.type),
  yieldCount: r.yield_count,
  yieldUnit: r.yield_unit === 'porsjoner' ? 'porsjoner' : 'stk',
  prepMinutes: num(r.prep_minutes, 0),
  finishedWeightG: optPos(r.finished_weight_g),
  ingredients: [...(r.recipe_ingredients ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((l): RecipeIngredient => ({ id: l.id, ingredientId: l.ingredient_id ?? '', subRecipeId: l.sub_recipe_id ?? null, amount: num(l.amount), unit: l.unit })),
  labor: laborFromJson(r.labor),
  packagingPerUnit: num(r.packaging_per_unit, 0),
  crossContact: (r.cross_contact ?? []).filter((c): c is Recipe['crossContact'][number] => (ALLERGEN_CODES as string[]).includes(c)),
  wastePercent: num(r.waste_percent, 0),
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
    category: r.category,
    yield_unit: r.yieldUnit,
    yield_count: Math.max(1, Math.round(r.yieldCount)),
    prep_minutes: Math.max(0, Math.round(r.prepMinutes || 0)),
    finished_weight_g: r.finishedWeightG && r.finishedWeightG > 0 ? r.finishedWeightG : null,
    steps: r.steps.filter((s) => s.trim()),
    rise_minutes: Math.round(r.riseMinutes),
    bake_minutes: Math.round(r.bakeMinutes),
    store_price_per_item: r.storePricePerItem,
    notes: r.notes,
    energy: r.energy,
    labor: (r.labor ?? []).slice(0, 50).map((l) => ({ id: l.id, roleId: l.roleId, people: clamp(l.people, 0, 1000), minutes: clamp(l.minutes, 0, 100000) })),
    packaging_per_unit: clamp(r.packagingPerUnit || 0, 0, 100000),
    cross_contact: r.crossContact ?? [],
    waste_percent: clamp(r.wastePercent || 0, 0, 94.99),
  },
  lines: r.ingredients.map((l) => l.subRecipeId
    ? { id: l.id, ingredient_id: null, sub_recipe_id: l.subRecipeId, amount: l.amount, unit: l.unit }
    : { id: l.id, ingredient_id: l.ingredientId || null, sub_recipe_id: null, amount: l.amount, unit: l.unit }),
})

export const equipmentFromRow = (r: EquipmentRow): EquipmentItem => ({
  id: r.id,
  name: r.name,
  type: EQUIPMENT_TYPES.includes(r.equipment_type as EquipmentItem['type']) ? (r.equipment_type as EquipmentItem['type']) : 'annet',
  manufacturer: r.manufacturer ?? '',
  model: r.model ?? '',
  watt: num(r.watt),
  minutes: num(r.minutes),
  powerPercent: num(r.power_factor_percent, 100),
  preheatMinutes: num(r.preheat_minutes, 0),
  preheatPowerPercent: num(r.preheat_power_percent, 100),
  measuredKwh: optPos(r.measured_kwh),
  outputPerRun: optPos(r.output_per_run),
  continuous: !!r.continuous,
  hoursPerDay: num(r.hours_per_day, 24),
  isEstimate: !!r.is_estimate,
  comment: r.comment ?? '',
})

/** Argument til RPC-en save_equipment. Verdiene holdes innenfor databasens grenser. */
export const equipmentToRpc = (e: EquipmentItem) => ({
  id: e.id,
  name: e.name.trim(),
  equipment_type: e.type,
  manufacturer: e.manufacturer.trim(),
  model: e.model.trim(),
  watt: clamp(e.watt, 0.01, 100000),
  minutes: clamp(e.minutes, 0, 10080),
  power_factor_percent: clamp(e.powerPercent, 0, 100),
  preheat_minutes: clamp(e.preheatMinutes, 0, 1440),
  preheat_power_percent: clamp(e.preheatPowerPercent, 0, 100),
  measured_kwh: e.measuredKwh && e.measuredKwh > 0 ? e.measuredKwh : null,
  output_per_run: e.outputPerRun && e.outputPerRun >= 1 ? Math.round(e.outputPerRun) : null,
  continuous: e.continuous,
  hours_per_day: clamp(e.hoursPerDay, 0, 24),
  is_estimate: e.isEstimate,
  comment: e.comment,
})

function menuItemsFromJson(v: unknown): MenuItem[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x, i) => ({ id: String(x.id ?? `m${i}`), recipeId: String(x.recipeId ?? ''), name: String(x.name ?? ''), price: num(x.price, 0), vatPercent: num(x.vatPercent, 15) }))
}

export const menuFromRow = (r: MenuRow): Menu => ({
  id: r.id,
  name: r.name,
  type: MENU_TYPES.includes(r.menu_type as Menu['type']) ? (r.menu_type as Menu['type']) : 'egen',
  description: r.description ?? '',
  items: menuItemsFromJson(r.items),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

/** Argument til RPC-en save_menu. */
export const menuToRpc = (m: Menu) => ({
  id: m.id,
  name: m.name.trim(),
  menu_type: m.type,
  description: m.description,
  items: m.items.slice(0, 300).map((i) => ({ id: i.id, recipeId: i.recipeId, name: i.name.trim(), price: clamp(i.price, 0, 1000000), vatPercent: clamp(i.vatPercent, 0, 100) })),
})

// ---------- Leverandører, priser, lager og svinn ----------
export interface SupplierRow {
  id: string; organization_id: string; name: string; contact_person: string | null; phone: string | null
  email: string | null; customer_number: string | null; comment: string | null
}
export const supplierFromRow = (r: SupplierRow): Supplier => ({
  id: r.id, name: r.name, contactPerson: r.contact_person ?? '', phone: r.phone ?? '', email: r.email ?? '',
  customerNumber: r.customer_number ?? '', comment: r.comment ?? '',
})
export const supplierToRow = (s: Supplier, organizationId: string) => ({
  id: s.id, organization_id: organizationId, name: s.name.trim().slice(0, 200), contact_person: s.contactPerson.trim().slice(0, 200),
  phone: s.phone.trim().slice(0, 50), email: s.email.trim().slice(0, 200), customer_number: s.customerNumber.trim().slice(0, 100), comment: s.comment.slice(0, 2000),
})

export interface PriceRow {
  id: string; ingredient_id: string; supplier_id: string | null; supplier_item_no: string | null; package_size: number | string
  unit: Ingredient['unit']; price: number | string; vat_percent: number | string | null; priced_at: string; source: string
}
export const priceFromRow = (r: PriceRow): PriceEntry => ({
  id: r.id, ingredientId: r.ingredient_id, supplierId: r.supplier_id, supplierItemNo: r.supplier_item_no ?? '',
  packageSize: num(r.package_size, 1), unit: r.unit, price: num(r.price), vatPercent: r.vat_percent === null ? null : num(r.vat_percent),
  pricedAt: r.priced_at, source: r.source === 'tilbud' ? 'tilbud' : 'historikk',
})
export const offerToRow = (p: PriceEntry, organizationId: string) => ({
  id: p.id, organization_id: organizationId, ingredient_id: p.ingredientId, supplier_id: p.supplierId, supplier_item_no: p.supplierItemNo.slice(0, 100),
  package_size: p.packageSize, unit: p.unit, price: Math.round(p.price * 100) / 100, vat_percent: p.vatPercent, priced_at: p.pricedAt, source: 'tilbud',
})

export interface StockRow {
  id: string; ingredient_id: string; quantity: number | string; kind: string; moved_at: string; unit_cost: number | string; note: string | null
}
const STOCK_KINDS = ['innkjop', 'forbruk', 'svinn', 'telling', 'justering'] as const
export const stockFromRow = (r: StockRow): StockMovement => ({
  id: r.id, ingredientId: r.ingredient_id, quantity: num(r.quantity), kind: (STOCK_KINDS as readonly string[]).includes(r.kind) ? (r.kind as StockMovement['kind']) : 'justering',
  movedAt: r.moved_at, unitCost: num(r.unit_cost), note: r.note ?? '',
})
export const stockToRow = (m: StockMovement, organizationId: string) => ({
  id: m.id, organization_id: organizationId, ingredient_id: m.ingredientId, quantity: Math.round(m.quantity * 10000) / 10000, kind: m.kind,
  moved_at: m.movedAt, unit_cost: Math.max(0, Math.round(m.unitCost * 1e6) / 1e6), note: m.note.slice(0, 500),
})

/** Beholdning per ingrediens fra bevegelser. */
export function stockLevelsFrom(movements: Pick<StockMovement, 'ingredientId' | 'quantity'>[]): Record<Id, number> {
  const out: Record<Id, number> = {}
  for (const m of movements) out[m.ingredientId] = (out[m.ingredientId] ?? 0) + m.quantity
  return out
}

export interface WasteRow {
  id: string; logged_at: string; ingredient_id: string | null; recipe_id: string | null; name: string; amount: number | string
  unit: Ingredient['unit']; cost: number | string; reason: string; note: string | null
}
export const wasteFromRow = (r: WasteRow): WasteLog => ({
  id: r.id, loggedAt: r.logged_at, ingredientId: r.ingredient_id, recipeId: r.recipe_id, name: r.name, amount: num(r.amount), unit: r.unit,
  cost: num(r.cost), reason: (WASTE_REASONS as string[]).includes(r.reason) ? (r.reason as WasteLog['reason']) : 'annet', note: r.note ?? '',
})
export const wasteToRpc = (w: WasteLog, stockQuantity: number | null, unitCost: number) => ({
  logged_at: w.loggedAt, ingredient_id: w.ingredientId ?? '', recipe_id: w.recipeId ?? '', name: w.name.trim().slice(0, 200) || 'Svinn',
  amount: w.amount, unit: w.unit, cost: Math.round(Math.max(0, w.cost) * 100) / 100, reason: w.reason, note: w.note.slice(0, 500),
  stock_quantity: stockQuantity ?? '', unit_cost: Math.max(0, unitCost),
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

export function settingsFromRows(user: UserSettingsRow | null, price: Partial<PriceSettings> | null, plan: Plan, businessType?: BusinessType | string | null): AppSettings {
  const def = defaultSettings()
  return {
    businessType: isBusinessType(businessType) ? businessType : def.businessType,
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
  businessType?: string | null
  ingredients: IngredientRow[]
  recipes: RecipeRow[]
  history: HistoryRow[]
  equipment?: EquipmentRow[]
  costs?: Partial<CostSettings> | null
  menus?: MenuRow[]
  suppliers?: SupplierRow[]
  prices?: PriceRow[]
  stockLevels?: { ingredient_id: string; quantity: number | string }[]
  stockMovements?: StockRow[]
  waste?: WasteRow[]
}): AppData {
  return {
    version: DATA_VERSION,
    settings: settingsFromRows(parts.user, parts.price, parts.plan, parts.businessType),
    ingredients: parts.ingredients.map(ingredientFromRow),
    recipes: parts.recipes.map(recipeFromRow),
    history: parts.history.map(historyFromRow),
    equipment: (parts.equipment ?? []).map(equipmentFromRow),
    costs: normalizeCostSettings(parts.costs),
    menus: (parts.menus ?? []).map(menuFromRow),
    suppliers: (parts.suppliers ?? []).map(supplierFromRow),
    prices: (parts.prices ?? []).map(priceFromRow),
    stockLevels: Object.fromEntries((parts.stockLevels ?? []).map((l) => [l.ingredient_id, num(l.quantity)])),
    stockMovements: (parts.stockMovements ?? []).map(stockFromRow),
    waste: (parts.waste ?? []).map(wasteFromRow),
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
