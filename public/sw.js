// Service worker: gjør at appen åpner uten nett.
//  * Sider: nett først, ellers siste lagrede versjon (så nye versjoner alltid
//    kommer med en gang telefonen er på nett).
//  * /assets/: filnavnene har innholds-hash og endres aldri, så de hentes fra
//    lageret først.
//  * Skanningsbibliotekene fra jsDelivr (låst til en versjon) lagres etter
//    første bruk, så skanning også virker uten nett.
// Supabase, strømpriser og Open Food Facts går alltid rett mot nettet og
// lagres ikke her. Bump VERSION for å tømme alt lagret ved neste oppdatering.
const VERSION = 'v1'
const SHELL = `shell-${VERSION}`
const ASSETS = `assets-${VERSION}`
const CDN = `cdn-${VERSION}`
const MAX_ASSETS = 80

const STATIC = ['/', '/manifest.webmanifest', '/favicon.svg', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL)
    await shell.addAll(STATIC)
    // Hent JS/CSS som forsiden peker på, så første besøk også virker uten nett
    const html = await (await shell.match('/')).text()
    const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])
    if (urls.length) await (await caches.open(ASSETS)).addAll(urls)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL, ASSETS, CDN]
    for (const key of await caches.keys()) if (!keep.includes(key)) await caches.delete(key)
    await self.clients.claim()
  })())
})

const isPinnedCdn = (url) =>
  /^(cdn|fastly)\.jsdelivr\.net$/.test(url.hostname) && /^\/npm\/(@[^/]+\/)?[^/@]+@[^/]+\//.test(url.pathname)

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') return event.respondWith(networkFirstPage(req))
    if (url.pathname.startsWith('/assets/')) return event.respondWith(cacheFirst(req, ASSETS, MAX_ASSETS))
    if (STATIC.includes(url.pathname)) return event.respondWith(networkFirst(req, SHELL))
    return
  }
  if (isPinnedCdn(url)) event.respondWith(cacheFirst(req, CDN))
})

async function networkFirstPage(req) {
  const cache = await caches.open(SHELL)
  // Appen er én side (hash-ruter), så forsiden dekker alle adresser
  const network = fetch(req).then(async (res) => {
    if (res.ok) await cache.put('/', res.clone())
    return res
  })
  const cached = await cache.match('/')
  if (!cached) return network
  // Dårlig dekning: bruk lagret versjon etter 4 s (den nye lagres når den kommer)
  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), 4000))
  return Promise.race([network.catch(() => cached), timeout])
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const res = await fetch(req)
    if (res.ok) await cache.put(req, res.clone())
    return res
  } catch {
    return (await cache.match(req)) ?? Response.error()
  }
}

async function cacheFirst(req, cacheName, max) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok || res.type === 'opaque') {
    await cache.put(req, res.clone())
    if (max) {
      const keys = await cache.keys()
      for (const old of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(old)
    }
  }
  return res
}
