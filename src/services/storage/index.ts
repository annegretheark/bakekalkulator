import { LocalStorageRepository } from './localStorageRepository'
import type { DataRepository } from './repository'

export type { DataRepository } from './repository'

/**
 * Velger lagringsimplementasjon. Når Supabase innføres byttes dette til
 * f.eks. `isSupabaseConfigured() && session ? new SupabaseRepository(client) : new LocalStorageRepository()`.
 */
export function createRepository(): DataRepository {
  return new LocalStorageRepository()
}
