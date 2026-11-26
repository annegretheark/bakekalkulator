import { LocalStorageRepository } from './localStorageRepository'

export type { DataRepository } from './repository'
export { LocalStorageRepository } from './localStorageRepository'
export { SupabaseRepository } from './supabaseRepository'

/** Lokal lagring – brukes uten innlogging og som kilde ved import. */
export const localRepository = new LocalStorageRepository()
