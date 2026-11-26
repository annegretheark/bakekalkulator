import { useSyncExternalStore } from 'react'

export type RouteKey = 'oversikt' | 'kalkulator' | 'strompriser' | 'oppskrifter' | 'ingredienser' | 'historikk' | 'salg' | 'innstillinger'

export const ROUTES: RouteKey[] = ['oversikt', 'kalkulator', 'strompriser', 'oppskrifter', 'ingredienser', 'historikk', 'salg', 'innstillinger']

/** Hash-basert ruting: fungerer på statisk hosting (Cloudflare Pages) uten serveroppsett. */
function read(): RouteKey {
  const h = window.location.hash.replace(/^#\/?/, '') as RouteKey
  return ROUTES.includes(h) ? h : 'oversikt'
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
