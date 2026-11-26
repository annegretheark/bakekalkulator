import type { Plan } from '../types'

/**
 * Klargjøring for gratis- og Pro-abonnement (Stripe kobles på senere).
 * Grensene håndheves ikke ennå – alle funksjoner er åpne i første versjon.
 */
export interface PlanLimits {
  maxRecipes: number
  maxHistory: number
  salesCalculator: boolean
  export: boolean
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { maxRecipes: Infinity, maxHistory: Infinity, salesCalculator: true, export: true },
  pro: { maxRecipes: Infinity, maxHistory: Infinity, salesCalculator: true, export: true },
}

export function canUse(plan: Plan, feature: keyof PlanLimits): boolean {
  const v = PLAN_LIMITS[plan][feature]
  return typeof v === 'boolean' ? v : v > 0
}
