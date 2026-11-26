import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppData, AppSettings, BakeLog, Id, Ingredient, Plan, Recipe } from '../../types'
import type { DataRepository } from './repository'
import {
  buildAppData, dbErrorMessage, historyToRow, ingredientToRpc, recipeToRpc,
  type HistoryRow, type IngredientRow, type RecipeRow, type UserSettingsRow,
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
    const [user, price, ingredients, recipes, history] = await Promise.all([
      this.client.from('user_settings').select('locale, currency, bakes_per_month').eq('user_id', this.userId).maybeSingle(),
      this.client.from('electricity_settings').select('settings').eq('organization_id', org).maybeSingle(),
      this.client.from('ingredients').select('*').eq('organization_id', org).order('name'),
      this.client.from('recipes').select('*, recipe_ingredients(id, ingredient_id, position, amount, unit)').eq('organization_id', org).order('created_at'),
      this.client.from('baking_history').select('*').eq('organization_id', org).order('baked_at', { ascending: false }).limit(1000),
    ])
    return buildAppData({
      user: this.check(user) as UserSettingsRow | null,
      price: (this.check(price) as { settings: AppSettings['price'] } | null)?.settings ?? null,
      plan: this.plan,
      ingredients: this.check(ingredients) as IngredientRow[],
      recipes: this.check(recipes) as RecipeRow[],
      history: this.check(history) as HistoryRow[],
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

  async replaceAll(): Promise<void> {
    throw new Error('Å erstatte alle data støttes ikke for kontoer i skyen. Bruk «Importer lokale data» under Konto.')
  }
}
