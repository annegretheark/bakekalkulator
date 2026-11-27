import type { Plan } from '../types'

/**
 * Abonnementsplaner. Grensene HÅNDHEVES I DATABASEN (plan_features +
 * triggeren enforce_plan_limits). Verdiene her er kun for visning i
 * brukergrensesnittet og må holdes i takt med migrasjonen.
 */
export interface PlanFeatures {
  maxRecipes: number | null // null = ubegrenset
  maxIngredients: number | null
  maxMembers: number
  salesCalculator: boolean
  /**
   * Skanning av oppskrifter, kvitteringer og strekkoder. Kjører helt i nettleseren
   * (ingen serverkostnad), så den styres bare i grensesnittet og finnes ikke i plan_features.
   */
  scanning: boolean
  /** AI-skanninger per måned (håndheves på serveren). */
  aiScans: number
  /** Lager, matsvinn og flere leverandører per vare (håndheves i databasen). */
  inventory: boolean
  /** Utvidet dashboard med trender. */
  advancedDashboard: boolean
}

export const PLAN_FEATURES: Record<Plan, PlanFeatures> = {
  free: { maxRecipes: 5, maxIngredients: 50, maxMembers: 1, salesCalculator: false, scanning: false, aiScans: 3, inventory: false, advancedDashboard: false },
  plus: { maxRecipes: 50, maxIngredients: 500, maxMembers: 3, salesCalculator: true, scanning: false, aiScans: 30, inventory: false, advancedDashboard: false },
  pro: { maxRecipes: null, maxIngredients: null, maxMembers: 25, salesCalculator: true, scanning: true, aiScans: 200, inventory: false, advancedDashboard: false },
  business: { maxRecipes: null, maxIngredients: null, maxMembers: 50, salesCalculator: true, scanning: true, aiScans: 500, inventory: true, advancedDashboard: false },
  business_plus: { maxRecipes: null, maxIngredients: null, maxMembers: 200, salesCalculator: true, scanning: true, aiScans: 1000, inventory: true, advancedDashboard: true },
}

export const PLAN_NAMES: Record<Plan, string> = { free: 'Free', plus: 'Plus', pro: 'Pro', business: 'Business', business_plus: 'Business Plus' }

export const TRIAL_DAYS = 30

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'

export interface SubscriptionInfo {
  plan: Plan
  status: SubscriptionStatus
  trial_started_at: string | null
  trial_ends_at: string | null
  current_period_end: string | null
  effective_plan?: Plan
}

/**
 * Samme regel som public.effective_plan_internal i databasen:
 * aktivt betalt abonnement → planen; aktiv prøve → Pro; ellers Free.
 */
export function effectivePlan(s: SubscriptionInfo | null | undefined, now = new Date()): Plan {
  if (!s) return 'free'
  const t = now.getTime()
  if (s.status === 'active' && (!s.current_period_end || Date.parse(s.current_period_end) > t)) return s.plan
  if (s.status === 'trialing' && s.trial_ends_at && Date.parse(s.trial_ends_at) > t) return 'pro'
  return 'free'
}

export function trialDaysLeft(s: SubscriptionInfo | null | undefined, now = new Date()): number | null {
  if (!s || s.status !== 'trialing' || !s.trial_ends_at) return null
  const ms = Date.parse(s.trial_ends_at) - now.getTime()
  return ms > 0 ? Math.ceil(ms / 86_400_000) : 0
}

export function canUse(plan: Plan, feature: 'salesCalculator' | 'scanning' | 'inventory' | 'advancedDashboard'): boolean {
  return !!PLAN_FEATURES[plan]?.[feature]
}
