import { useContext } from 'react'
import { AuthContext, type AuthValue } from '../context/authContext'

const LOCAL_ONLY: AuthValue = {
  configured: false, client: null, session: null, user: null, loading: false, context: null, contextError: null,
  activeOrg: null, plan: 'pro', isAdmin: false, recovery: false, clearRecovery: () => {}, flash: null, clearFlash: () => {},
  refresh: async () => {}, setActiveOrg: async () => {}, signOut: async () => {},
}

/** Autentiseringsstatus. Uten AuthProvider (f.eks. i tester) gjelder lokal modus. */
export function useAuth(): AuthValue {
  return useContext(AuthContext) ?? LOCAL_ONLY
}
