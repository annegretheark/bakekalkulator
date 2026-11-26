import type { AppData, AppSettings, BakeLog, Id, Ingredient, Recipe } from '../../types'
import { defaultSettings } from '../../lib/defaults'
import { DATA_VERSION, seedData } from '../../lib/seed'
import type { DataRepository } from './repository'

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
    ingredients: Array.isArray(raw.ingredients) ? raw.ingredients : [],
    recipes: Array.isArray(raw.recipes) ? raw.recipes : [],
    history: Array.isArray(raw.history) ? raw.history : [],
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
  saveSettings(settings: AppSettings) { return this.update((d) => ({ ...d, settings })) }
  upsertIngredient(item: Ingredient) { return this.update((d) => ({ ...d, ingredients: upsert(d.ingredients, item) })) }
  deleteIngredient(id: Id) { return this.update((d) => ({ ...d, ingredients: d.ingredients.filter((x) => x.id !== id) })) }
  upsertRecipe(item: Recipe) { return this.update((d) => ({ ...d, recipes: upsert(d.recipes, item) })) }
  deleteRecipe(id: Id) { return this.update((d) => ({ ...d, recipes: d.recipes.filter((x) => x.id !== id) })) }
  addLog(item: BakeLog) { return this.update((d) => ({ ...d, history: [item, ...d.history] })) }
  deleteLog(id: Id) { return this.update((d) => ({ ...d, history: d.history.filter((x) => x.id !== id) })) }
  replaceAll(data: AppData) { return this.update(() => migrate(data)) }
}
