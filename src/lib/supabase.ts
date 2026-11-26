import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Klargjort for Supabase (Auth, PostgreSQL, RLS). Brukes ikke i første versjon.
 * Sett VITE_SUPABASE_URL og VITE_SUPABASE_ANON_KEY i .env.local for å aktivere.
 * Ingen tabeller eller autentisering er opprettet ennå.
 */
let client: SupabaseClient | null = null

export function isSupabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
}

export function getSupabase(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  client ??= createClient(url, key)
  return client
}
