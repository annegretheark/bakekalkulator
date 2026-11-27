import type { Ingredient, Recipe } from '../types'
import { ingredientExtras } from './defaults'
import { toLocalDateKey, uid } from '../utils/format'

/** Tom ingrediens med dagens dato. */
export const blankIngredient = (): Ingredient => ({
  id: uid(), name: '', category: '', packageSize: 1, unit: 'kg', price: 0, store: '', priceUpdated: toLocalDateKey(new Date()), allergens: {}, allergensChecked: true, ...ingredientExtras(),
})

/**
 * Overlevering fra «Skann»-siden til skjemaene for ingrediens og oppskrift.
 * Holdes bare i minnet: et utkast som ikke åpnes, forsvinner ved ny innlasting.
 */
let ingredient: { draft: Ingredient; message: string } | null = null
let recipe: { draft: Recipe; message: string } | null = null

export function handOffIngredient(draft: Ingredient, message: string) { ingredient = { draft, message } }
export function takeIngredient() { const v = ingredient; ingredient = null; return v }
export function handOffRecipe(draft: Recipe, message: string) { recipe = { draft, message } }
export function takeRecipe() { const v = recipe; recipe = null; return v }
