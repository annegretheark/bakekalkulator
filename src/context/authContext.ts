import { createContext } from 'react'
import type { Session, SupabaseClient, User } from '@supabase/supabase-js'
import type { Plan } from '../types'
import type { SubscriptionInfo } from '../lib/plans'

export type OrgRole = 'owner' | 'admin' | 'member'

export interface OrgContext {
  id: string
  name: string
  type: 'private' | 'business'
  role: OrgRole
  member_count: number
  subscription: SubscriptionInfo | null
  features: { plan: Plan; max_recipes: number | null; max_ingredients: number | null; max_members: number; sales_calculator: boolean } | null
}

export interface MyContext {
  profile: { id: string; full_name: string; email: string | null; created_at: string } | null
  settings: { active_organization_id: string | null; locale: string; currency: string; bakes_per_month: number } | null
  is_system_admin: boolean
  organizations: OrgContext[]
  legal?: {
    current: { document: 'terms' | 'privacy'; version: string; url: string }[]
    accepted: { document: 'terms' | 'privacy'; version: string; accepted_at: string }[]
  }
}

export interface AuthValue {
  /** Supabase er konfigurert (ellers kun lokal modus). */
  configured: boolean
  client: SupabaseClient | null
  session: Session | null
  user: User | null
  loading: boolean
  context: MyContext | null
  contextError: string | null
  activeOrg: OrgContext | null
  /** Effektiv plan for aktiv organisasjon (håndheves på serveren). */
  plan: Plan
  isAdmin: boolean
  /** Brukeren kom via lenke for tilbakestilling av passord. */
  recovery: boolean
  clearRecovery: () => void
  flash: string | null
  clearFlash: () => void
  refresh: () => Promise<void>
  setActiveOrg: (id: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthValue | null>(null)
