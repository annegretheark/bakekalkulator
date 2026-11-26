import { useSyncExternalStore } from 'react'

export type AppRoute = 'oversikt' | 'kalkulator' | 'strompriser' | 'oppskrifter' | 'ingredienser' | 'historikk' | 'salg' | 'innstillinger'
export type AccountRoute = 'logg-inn' | 'registrer' | 'glemt-passord' | 'tilbakestill-passord' | 'konto' | 'admin' | 'personvern' | 'vilkar'
export type RouteKey = AppRoute | AccountRoute

/** Hovedsidene (menyen). */
export const ROUTES: AppRoute[] = ['oversikt', 'kalkulator', 'strompriser', 'oppskrifter', 'ingredienser', 'historikk', 'salg', 'innstillinger']
export const ACCOUNT_ROUTES: AccountRoute[] = ['logg-inn', 'registrer', 'glemt-passord', 'tilbakestill-passord', 'konto', 'admin', 'personvern', 'vilkar']
const ALL_ROUTES: RouteKey[] = [...ROUTES, ...ACCOUNT_ROUTES]

/** Sider som krever innlogging når Supabase er satt opp. */
export const PROTECTED_ROUTES: RouteKey[] = ['konto', 'admin', 'salg']

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
