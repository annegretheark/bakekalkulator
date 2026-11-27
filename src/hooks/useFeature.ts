import { canUse } from '../lib/plans'
import { useAuth } from './useAuth'

/**
 * Funksjoner som krever Business eller Business Plus. Håndheves i databasen –
 * dette styrer bare visningen. Uten Supabase (lokal modus) er alt åpent.
 */
export function useFeature(feature: 'inventory' | 'advancedDashboard') {
  const auth = useAuth()
  return { allowed: !auth.configured || canUse(auth.plan, feature), loggedIn: !!auth.user }
}
