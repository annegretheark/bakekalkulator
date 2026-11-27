import type { AppData, AppSettings, BakeLog, BusinessType, CostSettings, EquipmentItem, Id, Ingredient, Menu, PriceEntry, Recipe, StockMovement, Supplier, WasteLog } from '../../types'
import { normalizeCostSettings, normalizeIngredient, normalizeMenu, normalizeRecipe } from '../../utils/portions'
import { defaultSettings } from '../../lib/defaults'
import { DATA_VERSION, seedData } from '../../lib/seed'
import type { DataRepository } from './repository'
import { stockLevelsFrom } from './mappers'
import { withIngredientPrice } from '../../utils/inventory'
import { uid } from '../../utils/format'

const KEY = 'rettilomma.bakekalkulator.v1'

function upsert<T extends { id: Id }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id)
  if (i === -1) return [...list, item]
  const copy = [...list]
  copy[i] = item
  return copy
}

/** Fletter lagrede innstillinger med standardverdier, slik at nye felt får verdi etter oppdateringer. */
function migrate(raw: Partial<AppData>): AppData {
  const def = defaultSettings()
  const s = (raw.settings ?? {}) as Partial<AppSettings>
  return {
    version: DATA_VERSION,
    settings: { ...def, ...s, price: { ...def.price, ...(s.price ?? {}) } },
    ingredients: Array.isArray(raw.ingredients) ? raw.ingredients.map(normalizeIngredient) : [],
    recipes: Array.isArray(raw.recipes) ? raw.recipes.map(normalizeRecipe) : [],
    history: Array.isArray(raw.history) ? raw.history : [],
    equipment: Array.isArray(raw.equipment) ? raw.equipment : [],
    costs: normalizeCostSettings(raw.costs),
    menus: Array.isArray(raw.menus) ? raw.menus.map(normalizeMenu) : [],
    suppliers: Array.isArray(raw.suppliers) ? raw.suppliers : [],
    prices: Array.isArray(raw.prices) ? raw.prices : [],
    stockMovements: Array.isArray(raw.stockMovements) ? raw.stockMovements : [],
    // Beholdningen regnes alltid fra bevegelsene lokalt
    stockLevels: stockLevelsFrom(Array.isArray(raw.stockMovements) ? raw.stockMovements : []),
    waste: Array.isArray(raw.waste) ? raw.waste : [],
  }
}

export class LocalStorageRepository implements DataRepository {
  private storage: Storage | null

  constructor(storage?: Storage) {
    this.storage = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
  }

  private read(): AppData {
    try {
      const raw = this.storage?.getItem(KEY)
      if (!raw) {
        const seeded = seedData()
        this.write(seeded)
        return seeded
      }
      return migrate(JSON.parse(raw))
    } catch {
      return seedData()
    }
  }

  private write(data: AppData): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(data))
    } catch (e) {
      throw new Error('Kunne ikke lagre data lokalt (lagringsplassen kan være full eller blokkert).', { cause: e })
    }
  }

  private update(fn: (d: AppData) => AppData): Promise<void> {
    this.write(fn(this.read()))
    return Promise.resolve()
  }

  load() { return Promise.resolve(this.read()) }

  /** Leser lagrede data uten å legge inn eksempeldata (brukes ved import). */
  peek(): AppData | null {
    try {
      const raw = this.storage?.getItem(KEY)
      return raw ? migrate(JSON.parse(raw)) : null
    } catch {
      return null
    }
  }

  /** Sletter lokale data. Kalles kun etter bekreftet vellykket import. */
  clear(): void {
    this.storage?.removeItem(KEY)
  }
  saveSettings(settings: AppSettings) { return this.update((d) => ({ ...d, settings })) }
  upsertIngredient(item: Ingredient) { return this.update((d) => ({ ...withIngredientPrice(d, item), ingredients: upsert(d.ingredients, item) })) }
  deleteIngredient(id: Id) { return this.update((d) => ({ ...d, ingredients: d.ingredients.filter((x) => x.id !== id) })) }
  upsertRecipe(item: Recipe) { return this.update((d) => ({ ...d, recipes: upsert(d.recipes, item) })) }
  deleteRecipe(id: Id) { return this.update((d) => ({ ...d, recipes: d.recipes.filter((x) => x.id !== id) })) }
  addLog(item: BakeLog) { return this.update((d) => ({ ...d, history: [item, ...d.history] })) }
  deleteLog(id: Id) { return this.update((d) => ({ ...d, history: d.history.filter((x) => x.id !== id) })) }
  replaceAll(data: AppData) { return this.update(() => migrate(data)) }
  upsertEquipment(item: EquipmentItem) { return this.update((d) => ({ ...d, equipment: upsert(d.equipment, item) })) }
  deleteEquipment(id: Id) { return this.update((d) => ({ ...d, equipment: d.equipment.filter((x) => x.id !== id) })) }
  saveBusinessType(t: BusinessType) { return this.update((d) => ({ ...d, settings: { ...d.settings, businessType: t } })) }
  saveCostSettings(c: CostSettings) { return this.update((d) => ({ ...d, costs: c })) }
  upsertMenu(item: Menu) { return this.update((d) => ({ ...d, menus: upsert(d.menus, item) })) }
  deleteMenu(id: Id) { return this.update((d) => ({ ...d, menus: d.menus.filter((x) => x.id !== id) })) }
  upsertSupplier(item: Supplier) { return this.update((d) => ({ ...d, suppliers: upsert(d.suppliers, item) })) }
  deleteSupplier(id: Id) {
    return this.update((d) => ({
      ...d,
      suppliers: d.suppliers.filter((x) => x.id !== id),
      ingredients: d.ingredients.map((i) => (i.supplierId === id ? { ...i, supplierId: null } : i)),
      prices: d.prices.map((p) => (p.supplierId === id ? { ...p, supplierId: null } : p)),
    }))
  }
  addPriceOffer(item: PriceEntry) { return this.update((d) => ({ ...d, prices: [{ ...item, source: 'tilbud' as const }, ...d.prices] })) }
  deletePriceOffer(id: Id) { return this.update((d) => ({ ...d, prices: d.prices.filter((p) => !(p.id === id && p.source === 'tilbud')) })) }
  addStockMovements(items: StockMovement[]) { return this.update((d) => ({ ...d, stockMovements: [...items, ...d.stockMovements] })) }
  stockCount(ingredientId: Id, counted: number, unitCost: number, note: string) {
    return this.update((d) => {
      const delta = counted - (stockLevelsFrom(d.stockMovements)[ingredientId] ?? 0)
      if (Math.abs(delta) < 1e-9) return d
      return { ...d, stockMovements: [{ id: uid(), ingredientId, quantity: delta, kind: 'telling' as const, movedAt: new Date().toISOString(), unitCost, note }, ...d.stockMovements] }
    })
  }
  registerWaste(item: WasteLog, stockQuantity: number | null, unitCost: number) {
    return this.update((d) => {
      const moves: StockMovement[] = item.ingredientId && stockQuantity && stockQuantity > 0
        ? [{ id: uid(), ingredientId: item.ingredientId, quantity: -stockQuantity, kind: 'svinn', movedAt: new Date().toISOString(), unitCost, note: `Svinn: ${item.reason}` }]
        : []
      return { ...d, waste: [item, ...d.waste], stockMovements: [...moves, ...d.stockMovements] }
    })
  }
  deleteWaste(id: Id) { return this.update((d) => ({ ...d, waste: d.waste.filter((w) => w.id !== id) })) }
}
