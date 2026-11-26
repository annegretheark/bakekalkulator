import { createContext } from 'react'
import type { AppData, AppSettings, BakeLog, BakeType, EnergyInput, Id, Ingredient, Recipe } from '../types'

export type PriceBasis = 'now' | 'average' | 'cheapest'

/** Salgsfelt for bedrifter – deles mellom kalkulatoren og «Salg og fortjeneste». */
export interface SalesDraft {
  pricePerUnit: number
  priceIncludesVat: boolean
  vatRatePercent: number
  targetMarginPercent: number
  packagingPerUnit: number
  laborHours: number
  hourlyRate: number
}

/** Kalkulatorens arbeidsdata – deles mellom sidene (f.eks. til Salg og Oversikt). */
export interface CalculatorDraft {
  name: string
  type: BakeType
  count: number
  recipeId: Id | null
  storePricePerItem: number
  energy: EnergyInput
  priceBasis: PriceBasis
  sales: SalesDraft
}

export interface DataContextValue {
  data: AppData
  loading: boolean
  error: string | null
  clearError: () => void
  draft: CalculatorDraft
  setDraft: (fn: (d: CalculatorDraft) => CalculatorDraft) => void
  saveSettings: (s: AppSettings) => Promise<void>
  upsertIngredient: (i: Ingredient) => Promise<void>
  deleteIngredient: (id: Id) => Promise<void>
  upsertRecipe: (r: Recipe) => Promise<void>
  deleteRecipe: (id: Id) => Promise<void>
  addLog: (l: BakeLog) => Promise<void>
  deleteLog: (id: Id) => Promise<void>
  replaceAll: (d: AppData) => Promise<void>
}

export const DataContext = createContext<DataContextValue | null>(null)
