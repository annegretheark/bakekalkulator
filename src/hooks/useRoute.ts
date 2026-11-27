import { useSyncExternalStore } from 'react'

export type AppRoute = 'oversikt' | 'kalkulator' | 'strompriser' | 'oppskrifter' | 'ingredienser' | 'utstyr' | 'kostnader' | 'menyer' | 'skann' | 'leverandorer' | 'lager' | 'svinn' | 'dashboard' | 'historikk' | 'salg' | 'innstillinger'
export type AccountRoute = 'logg-inn' | 'registrer' | 'glemt-passord' | 'tilbakestill-passord' | 'konto' | 'admin' | 'personvern' | 'vilkar'
export type RouteKey = AppRoute | AccountRoute

/** Hovedsidene (menyen). */
export const ROUTES: AppRoute[] = ['oversikt', 'kalkulator', 'strompriser', 'oppskrifter', 'ingredienser', 'utstyr', 'kostnader', 'menyer', 'skann', 'leverandorer', 'lager', 'svinn', 'dashboard', 'historikk', 'salg', 'innstillinger']
export const ACCOUNT_ROUTES: AccountRoute[] = ['logg-inn', 'registrer', 'glemt-passord', 'tilbakestill-passord', 'konto', 'admin', 'personvern', 'vilkar']
const ALL_ROUTES: RouteKey[] = [...ROUTES, ...ACCOUNT_ROUTES]

/**
 * Sider som kan åpnes uten innlogging. Når Supabase er satt opp, krever alle
 * andre sider innlogging (i lokal modus uten Supabase er alt åpent).
 */
export const PUBLIC_ROUTES: RouteKey[] = ['logg-inn', 'registrer', 'glemt-passord', 'tilbakestill-passord', 'personvern', 'vilkar']

export function requiresLogin(route: RouteKey): boolean {
  return !PUBLIC_ROUTES.includes(route)
}

/** Hash-basert ruting: fungerer på statisk hosting (Cloudflare Pages) uten serveroppsett. */
function read(): RouteKey {
  const h = window.location.hash.replace(/^#\/?/, '') as RouteKey
  return ALL_ROUTES.includes(h) ? h : 'oversikt'
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function useRoute(): RouteKey {
  return useSyncExternalStore(subscribe, read, () => 'oversikt')
}

export function navigate(route: RouteKey) {
  window.location.hash = `/${route}`
  window.scrollTo({ top: 0 })
}
