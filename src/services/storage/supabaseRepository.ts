import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppData, AppSettings, BakeLog, BusinessType, CostSettings, EquipmentItem, Id, Ingredient, Menu, Plan, Recipe } from '../../types'
import type { DataRepository } from './repository'
import {
  buildAppData, dbErrorMessage, equipmentToRpc, historyToRow, ingredientToRpc, menuToRpc, recipeToRpc,
  type EquipmentRow, type HistoryRow, type IngredientRow, type MenuRow, type RecipeRow, type UserSettingsRow,
} from './mappers'

/**
 * Lagring i Supabase for innloggede brukere. All tilgang kontrolleres av
 * Row Level Security – klienten sender kun organization_id den er medlem av.
 */
export class SupabaseRepository implements DataRepository {
  private client: SupabaseClient
  private organizationId: string
  private userId: string
  private plan: Plan

  constructor(client: SupabaseClient, organizationId: string, userId: string, plan: Plan) {
    this.client = client
    this.organizationId = organizationId
    this.userId = userId
    this.plan = plan
  }

  private check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
    if (res.error) throw new Error(dbErrorMessage(res.error))
    return res.data
  }

  async load(): Promise<AppData> {
    const org = this.organizationId
    const [user, price, ingredients, recipes, history, equipment, organization, costs, menus] = await Promise.all([
      this.client.from('user_settings').select('locale, currency, bakes_per_month').eq('user_id', this.userId).maybeSingle(),
      this.client.from('electricity_settings').select('settings').eq('organization_id', org).maybeSingle(),
      this.client.from('ingredients').select('*').eq('organization_id', org).order('name'),
      this.client.from('recipes').select('*, recipe_ingredients!recipe_id(*)').eq('organization_id', org).order('created_at'),
      this.client.from('baking_history').select('*').eq('organization_id', org).order('baked_at', { ascending: false }).limit(1000),
      this.client.from('equipment').select('*').eq('organization_id', org).order('created_at'),
      this.client.from('organizations').select('business_type').eq('id', org).maybeSingle(),
      this.client.from('cost_settings').select('settings').eq('organization_id', org).maybeSingle(),
      this.client.from('menus').select('*').eq('organization_id', org).order('created_at'),
    ])
    return buildAppData({
      user: this.check(user) as UserSettingsRow | null,
      price: (this.check(price) as { settings: AppSettings['price'] } | null)?.settings ?? null,
      plan: this.plan,
      // Tåler at fase 1-migrasjonen ikke er kjørt ennå (kolonnen mangler): da brukes standard
      businessType: organization.error ? null : (organization.data as { business_type?: string } | null)?.business_type ?? null,
      ingredients: this.check(ingredients) as IngredientRow[],
      recipes: this.check(recipes) as RecipeRow[],
      history: this.check(history) as HistoryRow[],
      equipment: this.check(equipment) as EquipmentRow[],
      // Tåler at fase 2-migrasjonen ikke er kjørt ennå (tabellene mangler)
      costs: costs.error ? null : (costs.data as { settings: Partial<CostSettings> } | null)?.settings ?? null,
      menus: menus.error ? [] : (menus.data as MenuRow[]),
    })
  }

  async saveSettings(s: AppSettings): Promise<void> {
    this.check(await this.client.from('user_settings')
      .update({ locale: s.locale, currency: s.currency, bakes_per_month: s.bakesPerMonth })
      .eq('user_id', this.userId))
    const rows = this.check(await this.client.from('electricity_settings')
      .update({ settings: s.price }) // updated_by settes av serveren
      .eq('organization_id', this.organizationId)
      .select('organization_id'))
    if (!rows || rows.length === 0) throw new Error('Bare eier eller administrator kan endre strømoppsettet for organisasjonen.')
  }

  /** Redigering eller ny ingrediens via RPC (id og organization_id kan ikke endres av klienten). */
  async upsertIngredient(item: Ingredient): Promise<void> {
    this.check(await this.client.rpc('save_ingredient', { org: this.organizationId, ingredient: ingredientToRpc(item) }))
  }

  async deleteIngredient(id: Id): Promise<void> {
    this.check(await this.client.from('ingredients').delete().eq('id', id).eq('organization_id', this.organizationId))
  }

  async upsertRecipe(item: Recipe): Promise<void> {
    const { recipe, lines } = recipeToRpc(item)
    this.check(await this.client.rpc('save_recipe', { org: this.organizationId, recipe, lines }))
  }

  async deleteRecipe(id: Id): Promise<void> {
    this.check(await this.client.from('recipes').delete().eq('id', id).eq('organization_id', this.organizationId))
  }

  async addLog(item: BakeLog): Promise<void> {
    this.check(await this.client.from('baking_history').insert(historyToRow(item, this.organizationId, item.snapshot ?? {})))
  }

  async deleteLog(id: Id): Promise<void> {
    this.check(await this.client.from('baking_history').delete().eq('id', id).eq('organization_id', this.organizationId))
  }

  async upsertEquipment(item: EquipmentItem): Promise<void> {
    this.check(await this.client.rpc('save_equipment', { org: this.organizationId, item: equipmentToRpc(item) }))
  }

  async deleteEquipment(id: Id): Promise<void> {
    this.check(await this.client.from('equipment').delete().eq('id', id).eq('organization_id', this.organizationId))
  }

  async saveBusinessType(t: BusinessType): Promise<void> {
    const rows = this.check(await this.client.from('organizations')
      .update({ business_type: t })
      .eq('id', this.organizationId)
      .select('id'))
    if (!rows || rows.length === 0) throw new Error('Bare eier eller administrator kan endre virksomhetstype.')
  }

  async saveCostSettings(c: CostSettings): Promise<void> {
    this.check(await this.client.rpc('save_cost_settings', { org: this.organizationId, settings: c }))
  }

  async upsertMenu(m: Menu): Promise<void> {
    this.check(await this.client.rpc('save_menu', { org: this.organizationId, menu: menuToRpc(m) }))
  }

  async deleteMenu(id: Id): Promise<void> {
    this.check(await this.client.from('menus').delete().eq('id', id).eq('organization_id', this.organizationId))
  }

  async replaceAll(): Promise<void> {
    throw new Error('Å erstatte alle data støttes ikke for kontoer i skyen. Bruk «Importer lokale data» under Konto.')
  }
}
