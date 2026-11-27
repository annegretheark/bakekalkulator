import type { AppData, AppSettings, BakeLog, BusinessType, EquipmentItem, Id, Ingredient, Recipe } from '../../types'

/**
 * Datalagringslaget. Brukergrensesnittet snakker kun med dette grensesnittet.
 *
 * Første versjon: LocalStorageRepository.
 * Senere: SupabaseRepository som implementerer samme grensesnitt, der hver
 * metode tilsvarer en tabell (settings, ingredients, recipes, bake_logs) med
 * user_id-kolonne og Row Level Security (`auth.uid() = user_id`).
 */
export interface DataRepository {
  load(): Promise<AppData>
  saveSettings(settings: AppSettings): Promise<void>
  upsertIngredient(item: Ingredient): Promise<void>
  deleteIngredient(id: Id): Promise<void>
  upsertRecipe(item: Recipe): Promise<void>
  deleteRecipe(id: Id): Promise<void>
  addLog(item: BakeLog): Promise<void>
  deleteLog(id: Id): Promise<void>
  replaceAll(data: AppData): Promise<void>
  upsertEquipment(item: EquipmentItem): Promise<void>
  deleteEquipment(id: Id): Promise<void>
  /** Virksomhetstype. I skyen lagres den på organisasjonen (eier/administrator). */
  saveBusinessType(t: BusinessType): Promise<void>
}
