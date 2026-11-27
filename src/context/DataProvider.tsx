import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppData, AppSettings, BakeLog, BusinessType, CostSettings, EquipmentItem, Id, Ingredient, Menu, PriceEntry, Recipe, StockMovement, Supplier, WasteLog } from '../types'
import { withIngredientPrice } from '../utils/inventory'
import { uid } from '../utils/format'
import { syncEnergyWithRegister } from '../utils/equipment'
import type { DataRepository } from '../services/storage'
import { emptyData } from '../lib/seed'
import { defaultEnergyInput, defaultSalesDraft } from '../lib/defaults'
import { DataContext, type CalculatorDraft } from './dataContext'

function upsert<T extends { id: Id }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]
}

/** Legger til lagerbevegelser og oppdaterer beholdningen. */
function withMovements(d: AppData, ms: StockMovement[]): AppData {
  const stockLevels = { ...d.stockLevels }
  for (const m of ms) stockLevels[m.ingredientId] = (stockLevels[m.ingredientId] ?? 0) + m.quantity
  return { ...d, stockLevels, stockMovements: [...ms, ...d.stockMovements] }
}

/** Oppdaterer utstyrsverdiene i oppskriftene fra registeret (effekt, forvarming, målt forbruk). */
function withSyncedEquipment(d: AppData): AppData {
  if (!d.equipment.length) return d
  return { ...d, recipes: d.recipes.map((r) => {
    const energy = syncEnergyWithRegister(r.energy, d.equipment)
    return energy === r.energy ? r : { ...r, energy }
  }) }
}

/**
 * Data og handlinger for appen. `repository` er localStorage (uten innlogging)
 * eller Supabase (innlogget). Komponenten monteres på nytt (key) ved bytte.
 */
export function DataProvider({ children, repository: repo }: { children: ReactNode; repository: DataRepository }) {
  const [data, setData] = useState<AppData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraftState] = useState<CalculatorDraft>({
    name: '', type: 'brod', count: 3, recipeId: null, storePricePerItem: 0, energy: defaultEnergyInput(), priceBasis: 'now', sales: defaultSalesDraft(),
  })

  useEffect(() => {
    repo.load()
      .then((loaded) => {
        const d = withSyncedEquipment(loaded)
        setData(d)
        const r = d.recipes[0]
        if (r) {
          setDraftState((prev) => ({
            ...prev, name: r.name, type: r.type, count: r.yieldCount, recipeId: r.id,
            storePricePerItem: r.storePricePerItem, energy: { ...r.energy, bakeMinutes: r.bakeMinutes || r.energy.bakeMinutes },
          }))
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Kunne ikke laste data.'))
      .finally(() => setLoading(false))
  }, [repo])

  /**
   * Optimistisk oppdatering. Feiler lagringen (f.eks. plangrense eller manglende
   * tilgang i Supabase), hentes gjeldende data på nytt fra lagringen.
   */
  const mutate = useCallback(async (local: (d: AppData) => AppData, persist: () => Promise<void>) => {
    setData(local)
    try {
      await persist()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lagring feilet.')
      try { setData(await repo.load()) } catch { /* behold visningen; feilen er allerede vist */ }
    }
  }, [repo])

  const value = useMemo(() => ({
    data, loading, error, draft,
    clearError: () => setError(null),
    setDraft: (fn: (d: CalculatorDraft) => CalculatorDraft) => setDraftState(fn),
    saveSettings: (s: AppSettings) => mutate((d) => ({ ...d, settings: s }), () => repo.saveSettings(s)),
    upsertIngredient: (i: Ingredient) => mutate((d) => ({ ...withIngredientPrice(d, i), ingredients: upsert(d.ingredients, i) }), () => repo.upsertIngredient(i)),
    deleteIngredient: (id: Id) => mutate((d) => ({ ...d, ingredients: d.ingredients.filter((x) => x.id !== id) }), () => repo.deleteIngredient(id)),
    upsertRecipe: (r: Recipe) => mutate((d) => ({ ...d, recipes: upsert(d.recipes, r) }), () => repo.upsertRecipe(r)),
    deleteRecipe: (id: Id) => mutate((d) => ({ ...d, recipes: d.recipes.filter((x) => x.id !== id) }), () => repo.deleteRecipe(id)),
    addLog: (l: BakeLog) => mutate((d) => ({ ...d, history: [l, ...d.history] }), () => repo.addLog(l)),
    deleteLog: (id: Id) => mutate((d) => ({ ...d, history: d.history.filter((x) => x.id !== id) }), () => repo.deleteLog(id)),
    replaceAll: (nd: AppData) => mutate(() => nd, () => repo.replaceAll(nd)),
    upsertEquipment: async (e: EquipmentItem) => {
      await mutate((d) => withSyncedEquipment({ ...d, equipment: upsert(d.equipment, e) }), () => repo.upsertEquipment(e))
      setDraftState((dr) => ({ ...dr, energy: syncEnergyWithRegister(dr.energy, [e]) }))
    },
    deleteEquipment: (id: Id) => mutate((d) => ({ ...d, equipment: d.equipment.filter((x) => x.id !== id) }), () => repo.deleteEquipment(id)),
    saveBusinessType: (t: BusinessType) => mutate((d) => ({ ...d, settings: { ...d.settings, businessType: t } }), () => repo.saveBusinessType(t)),
    saveCostSettings: (c: CostSettings) => mutate((d) => ({ ...d, costs: c }), () => repo.saveCostSettings(c)),
    upsertMenu: (m: Menu) => mutate((d) => ({ ...d, menus: upsert(d.menus, m) }), () => repo.upsertMenu(m)),
    deleteMenu: (id: Id) => mutate((d) => ({ ...d, menus: d.menus.filter((x) => x.id !== id) }), () => repo.deleteMenu(id)),
    upsertSupplier: (s: Supplier) => mutate((d) => ({ ...d, suppliers: upsert(d.suppliers, s) }), () => repo.upsertSupplier(s)),
    deleteSupplier: (id: Id) => mutate((d) => ({
      ...d,
      suppliers: d.suppliers.filter((x) => x.id !== id),
      ingredients: d.ingredients.map((i) => (i.supplierId === id ? { ...i, supplierId: null } : i)),
    }), () => repo.deleteSupplier(id)),
    addPriceOffer: (p: PriceEntry) => mutate((d) => ({ ...d, prices: [{ ...p, source: 'tilbud' as const }, ...d.prices] }), () => repo.addPriceOffer(p)),
    deletePriceOffer: (id: Id) => mutate((d) => ({ ...d, prices: d.prices.filter((p) => p.id !== id) }), () => repo.deletePriceOffer(id)),
    addStockMovements: (ms: StockMovement[]) => mutate((d) => withMovements(d, ms), () => repo.addStockMovements(ms)),
    stockCount: (ingredientId: Id, counted: number, unitCost: number, note: string) => mutate((d) => {
      const delta = counted - (d.stockLevels[ingredientId] ?? 0)
      return Math.abs(delta) < 1e-9 ? d : withMovements(d, [{ id: uid(), ingredientId, quantity: delta, kind: 'telling', movedAt: new Date().toISOString(), unitCost, note }])
    }, () => repo.stockCount(ingredientId, counted, unitCost, note)),
    registerWaste: (w: WasteLog, stockQuantity: number | null, unitCost: number) => mutate((d) => {
      const withLog = { ...d, waste: [w, ...d.waste] }
      return w.ingredientId && stockQuantity && stockQuantity > 0
        ? withMovements(withLog, [{ id: uid(), ingredientId: w.ingredientId, quantity: -stockQuantity, kind: 'svinn', movedAt: new Date().toISOString(), unitCost, note: `Svinn: ${w.reason}` }])
        : withLog
    }, () => repo.registerWaste(w, stockQuantity, unitCost)),
    deleteWaste: (id: Id) => mutate((d) => ({ ...d, waste: d.waste.filter((w) => w.id !== id) }), () => repo.deleteWaste(id)),
  }), [data, loading, error, draft, mutate, repo])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
