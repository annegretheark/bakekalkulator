import { canUse } from '../lib/plans'
import { useAuth } from './useAuth'

/** Skanning er en Pro-funksjon. Uten Supabase (lokal modus) er alt åpent. */
export function useScanAllowed() {
  const auth = useAuth()
  return { allowed: !auth.configured || canUse(auth.plan, 'scanning'), loggedIn: !!auth.user }
}
