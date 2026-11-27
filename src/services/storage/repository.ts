import type { AppData, AppSettings, BakeLog, BusinessType, CostSettings, EquipmentItem, Id, Ingredient, Menu, PriceEntry, Recipe, StockMovement, Supplier, WasteLog } from '../../types'

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
  /** Personal- og driftskostnader. I skyen: eier/administrator. */
  saveCostSettings(c: CostSettings): Promise<void>
  upsertMenu(item: Menu): Promise<void>
  deleteMenu(id: Id): Promise<void>
  upsertSupplier(item: Supplier): Promise<void>
  deleteSupplier(id: Id): Promise<void>
  /** Pris fra en annen leverandør (Business). Prishistorikken skrives automatisk. */
  addPriceOffer(item: PriceEntry): Promise<void>
  deletePriceOffer(id: Id): Promise<void>
  /** Lagerbevegelser (Business). Lagres samlet (alle eller ingen). */
  addStockMovements(items: StockMovement[]): Promise<void>
  /** Varetelling: setter beholdningen til talt mengde. */
  stockCount(ingredientId: Id, counted: number, unitCost: number, note: string): Promise<void>
  /** Registrer svinn (Business), eventuelt med uttak fra lager i samme transaksjon. */
  registerWaste(item: WasteLog, stockQuantity: number | null, unitCost: number): Promise<void>
  deleteWaste(id: Id): Promise<void>
}
