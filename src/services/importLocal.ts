import type { AppData } from '../types'
import { dbErrorMessage } from './storage/mappers'
import { cleanAllergenMap } from '../lib/allergens'

/**
 * Import av lokale oppskrifter og ingredienser til en Supabase-organisasjon.
 *
 * - Lokale id-er sendes som local_id. Databasen hopper over det som allerede
 *   er importert (unique(organization_id, local_id)), så gjentatt import gir
 *   ingen duplikater.
 * - Hele importen kjører i én transaksjon (RPC import_local_data).
 * - Lokale data slettes ALDRI automatisk; brukeren kan velge det etterpå.
 */

export interface ImportPayload {
  ingredients: {
    local_id: string; name: string; category: string; package_size: number; unit: string
    price: number; store: string; price_updated: string
    allergens: Record<string, string>; allergens_checked: boolean
  }[]
  recipes: {
    local_id: string; name: string; type: string; yield_count: number; steps: string[]
    rise_minutes: number; bake_minutes: number; store_price_per_item: number; notes: string
    energy: unknown
    category: string; yield_unit: string; prep_minutes: number; finished_weight_g: number | null
    packaging_per_unit: number; cross_contact: string[]
    ingredients: { ingredient_local_id: string | null; sub_recipe_local_id: string | null; amount: number; unit: string }[]
  }[]
}

export interface ImportResult {
  ingredients_inserted: number
  ingredients_skipped: number
  recipes_inserted: number
  recipes_skipped: number
}

const validLocalId = (id: unknown): id is string => typeof id === 'string' && id.trim().length > 0 && id.trim().length <= 100

/** Bygger nyttelasten. Rader uten gyldig lokal id utelates (serveren krever den for duplikatkontroll). */
export function buildImportPayload(data: Pick<AppData, 'ingredients' | 'recipes'>): ImportPayload {
  const ingredientIds = new Set(data.ingredients.filter((i) => validLocalId(i.id)).map((i) => i.id.trim()))
  const recipeIds = new Set(data.recipes.filter((r) => validLocalId(r.id)).map((r) => r.id.trim()))
  return {
    ingredients: data.ingredients
      .filter((i) => validLocalId(i.id) && i.name.trim() && i.packageSize > 0 && i.price >= 0)
      .map((i) => ({
        local_id: i.id.trim(),
        name: i.name.trim().slice(0, 200),
        category: (i.category ?? '').slice(0, 100),
        package_size: i.packageSize,
        unit: i.unit,
        price: Math.round(i.price * 100) / 100,
        store: (i.store ?? '').slice(0, 200),
        price_updated: /^\d{4}-\d{2}-\d{2}$/.test(i.priceUpdated) ? i.priceUpdated : new Date().toISOString().slice(0, 10),
        allergens: cleanAllergenMap(i.allergens),
        allergens_checked: i.allergensChecked !== false,
      })),
    recipes: data.recipes
      .filter((r) => validLocalId(r.id) && r.name.trim() && r.yieldCount >= 1)
      .map((r) => ({
        local_id: r.id.trim(),
        name: r.name.trim().slice(0, 200),
        type: r.type,
        yield_count: Math.round(r.yieldCount),
        steps: r.steps.filter((s) => s.trim()),
        rise_minutes: Math.round(r.riseMinutes),
        bake_minutes: Math.round(r.bakeMinutes),
        store_price_per_item: r.storePricePerItem,
        notes: r.notes ?? '',
        energy: r.energy,
        category: r.category ?? 'annet',
        yield_unit: r.yieldUnit === 'porsjoner' ? 'porsjoner' : 'stk',
        prep_minutes: Math.round(r.prepMinutes || 0),
        finished_weight_g: r.finishedWeightG && r.finishedWeightG > 0 ? r.finishedWeightG : null,
        // Arbeidstid importeres ikke: rollene (personalkostnader) er lokale og følger ikke med
        packaging_per_unit: r.packagingPerUnit > 0 ? r.packagingPerUnit : 0,
        cross_contact: r.crossContact ?? [],
        ingredients: r.ingredients.map((l) => ({
          ingredient_local_id: !l.subRecipeId && ingredientIds.has(l.ingredientId) ? l.ingredientId : null,
          sub_recipe_local_id: l.subRecipeId && recipeIds.has(l.subRecipeId) && l.subRecipeId !== r.id ? l.subRecipeId : null,
          amount: l.amount,
          unit: l.unit,
        })),
      })),
  }
}

export function hasImportableData(data: Pick<AppData, 'ingredients' | 'recipes'> | null): boolean {
  return !!data && (data.ingredients.length > 0 || data.recipes.length > 0)
}

export interface RpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>
}

export async function importLocalData(client: RpcClient, organizationId: string, data: Pick<AppData, 'ingredients' | 'recipes'>): Promise<ImportResult> {
  const { data: result, error } = await client.rpc('import_local_data', { org: organizationId, payload: buildImportPayload(data) })
  if (error) throw new Error(dbErrorMessage(error))
  return result as ImportResult
}

// ---------- Logg over gjennomførte importer (per organisasjon, lokalt) ----------
const IMPORT_KEY = 'rettilomma.bakekalkulator.imports'

export function getImportRecord(organizationId: string): { at: string; result: ImportResult } | null {
  try {
    const all = JSON.parse(localStorage.getItem(IMPORT_KEY) ?? '{}')
    return all[organizationId] ?? null
  } catch {
    return null
  }
}

export function saveImportRecord(organizationId: string, result: ImportResult): void {
  try {
    const all = JSON.parse(localStorage.getItem(IMPORT_KEY) ?? '{}')
    all[organizationId] = { at: new Date().toISOString(), result }
    localStorage.setItem(IMPORT_KEY, JSON.stringify(all))
  } catch {
    /* ikke kritisk */
  }
}
