import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppData, AppSettings, BakeLog, Id, Ingredient, Recipe } from '../types'
import type { DataRepository } from '../services/storage'
import { emptyData } from '../lib/seed'
import { defaultEnergyInput, defaultSalesDraft } from '../lib/defaults'
import { DataContext, type CalculatorDraft } from './dataContext'

function upsert<T extends { id: Id }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]
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
      .then((d) => {
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
    upsertIngredient: (i: Ingredient) => mutate((d) => ({ ...d, ingredients: upsert(d.ingredients, i) }), () => repo.upsertIngredient(i)),
    deleteIngredient: (id: Id) => mutate((d) => ({ ...d, ingredients: d.ingredients.filter((x) => x.id !== id) }), () => repo.deleteIngredient(id)),
    upsertRecipe: (r: Recipe) => mutate((d) => ({ ...d, recipes: upsert(d.recipes, r) }), () => repo.upsertRecipe(r)),
    deleteRecipe: (id: Id) => mutate((d) => ({ ...d, recipes: d.recipes.filter((x) => x.id !== id) }), () => repo.deleteRecipe(id)),
    addLog: (l: BakeLog) => mutate((d) => ({ ...d, history: [l, ...d.history] }), () => repo.addLog(l)),
    deleteLog: (id: Id) => mutate((d) => ({ ...d, history: d.history.filter((x) => x.id !== id) }), () => repo.deleteLog(id)),
    replaceAll: (nd: AppData) => mutate(() => nd, () => repo.replaceAll(nd)),
  }), [data, loading, error, draft, mutate, repo])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
