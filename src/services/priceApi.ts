import type { PriceArea, PriceInterval } from '../types'

const BASE = 'https://www.hvakosterstrommen.no/api/v1/prices'

export type PriceErrorKind = 'not-available' | 'network' | 'invalid'

export class PriceApiError extends Error {
  kind: PriceErrorKind
  constructor(kind: PriceErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

interface ApiRow {
  NOK_per_kWh: number
  time_start: string
  time_end: string
}

/** Dato i norsk tid som YYYY-MM-DD – API-et bruker norske døgn. */
export function osloDateKey(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export function priceUrl(dateKey: string, area: PriceArea): string {
  const [y, m, d] = dateKey.split('-')
  return `${BASE}/${y}/${m}-${d}_${area}.json`
}

export function parsePriceRows(rows: unknown): PriceInterval[] {
  if (!Array.isArray(rows)) throw new PriceApiError('invalid', 'Uventet svar fra strømpris-tjenesten.')
  return rows
    .filter((r): r is ApiRow => typeof r?.NOK_per_kWh === 'number' && typeof r?.time_start === 'string' && typeof r?.time_end === 'string')
    .map((r) => ({ start: r.time_start, end: r.time_end, spotNokPerKwh: r.NOK_per_kWh }))
}

const cache = new Map<string, Promise<PriceInterval[]>>()

/**
 * Henter spotpriser (eks. mva) for én dag og ett prisområde.
 * Støtter både timespriser (24) og kvarterspriser (96) – lengden leses fra data.
 */
export function fetchPrices(dateKey: string, area: PriceArea): Promise<PriceInterval[]> {
  const url = priceUrl(dateKey, area)
  const hit = cache.get(url)
  if (hit) return hit
  const p = (async () => {
    let res: Response
    try {
      res = await fetch(url)
    } catch {
      throw new PriceApiError('network', 'Fikk ikke kontakt med strømpris-tjenesten. Sjekk nettforbindelsen.')
    }
    if (res.status === 404) throw new PriceApiError('not-available', 'Prisene for denne dagen er ikke publisert ennå.')
    if (!res.ok) throw new PriceApiError('network', `Strømpris-tjenesten svarte med feil (${res.status}).`)
    const rows = parsePriceRows(await res.json())
    if (rows.length === 0) throw new PriceApiError('invalid', 'Ingen priser i svaret.')
    return rows
  })()
  cache.set(url, p)
  p.catch(() => cache.delete(url))
  return p
}
