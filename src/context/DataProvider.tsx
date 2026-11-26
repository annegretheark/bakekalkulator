import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppData, AppSettings, BakeLog, Id, Ingredient, Recipe } from '../types'
import { createRepository } from '../services/storage'
import { emptyData } from '../lib/seed'
import { defaultEnergyInput } from '../lib/defaults'
import { DataContext, type CalculatorDraft } from './dataContext'

const repo = createRepository()

function upsert<T extends { id: Id }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraftState] = useState<CalculatorDraft>({
    name: '', type: 'brod', count: 3, recipeId: null, storePricePerItem: 0, energy: defaultEnergyInput(), priceBasis: 'now',
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
  }, [])

  /** Optimistisk oppdatering med tilbakerulling ved lagringsfeil. */
  const mutate = useCallback(async (local: (d: AppData) => AppData, persist: () => Promise<void>) => {
    let previous: AppData | null = null
    setData((d) => { previous = d; return local(d) })
    try {
      await persist()
    } catch (e) {
      if (previous) setData(previous)
      setError(e instanceof Error ? e.message : 'Lagring feilet.')
    }
  }, [])

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
  }), [data, loading, error, draft, mutate])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
