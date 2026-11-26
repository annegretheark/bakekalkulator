import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase-klient for nettleseren.
 *
 * Bruker KUN den offentlige nøkkelen (publishable/anon). Tilgang styres av
 * Row Level Security i databasen. service_role eller andre hemmelige nøkler
 * skal aldri ligge i frontend eller i VITE_-variabler.
 *
 * Sett VITE_SUPABASE_URL og VITE_SUPABASE_ANON_KEY i .env.local.
 * Uten disse kjører appen i lokal modus (localStorage) uten innlogging.
 */
let client: SupabaseClient | null = null

export function isSupabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
}

/** Avviser åpenbart hemmelige nøkler, slik at de ikke tas i bruk i nettleseren ved en feil. */
export function assertPublicKey(key: string): void {
  if (key.startsWith('sb_secret_')) throw new Error('Hemmelig Supabase-nøkkel (sb_secret_) kan ikke brukes i frontend.')
  const parts = key.split('.')
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (payload?.role === 'service_role') throw new Error('service_role-nøkkel kan ikke brukes i frontend.')
    } catch (e) {
      if (e instanceof Error && e.message.includes('service_role')) throw e
    }
  }
}

export function getSupabase(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  if (!client) {
    assertPublicKey(key)
    client = createClient(url, key, {
      auth: {
        persistSession: true, // vedvarende innlogging
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce', // ?code= i stedet for #token – kolliderer ikke med hash-rutingen
      },
    })
  }
  return client
}
