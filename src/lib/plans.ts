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
}

export const PLAN_FEATURES: Record<Plan, PlanFeatures> = {
  free: { maxRecipes: 5, maxIngredients: 50, maxMembers: 1, salesCalculator: false },
  plus: { maxRecipes: 50, maxIngredients: 500, maxMembers: 3, salesCalculator: true },
  pro: { maxRecipes: null, maxIngredients: null, maxMembers: 25, salesCalculator: true },
}

export const PLAN_NAMES: Record<Plan, string> = { free: 'Free', plus: 'Plus', pro: 'Pro' }

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

export function canUse(plan: Plan, feature: 'salesCalculator'): boolean {
  return PLAN_FEATURES[plan][feature]
}
