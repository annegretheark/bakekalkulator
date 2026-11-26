// Formatering via Intl – locale og valuta kommer fra innstillingene,
// slik at flere språk/valutaer kan støttes senere.

export interface FormatOptions {
  locale: string
  currency: string
}

export const DEFAULT_FORMAT: FormatOptions = { locale: 'nb-NO', currency: 'NOK' }

export function formatMoney(n: number | null | undefined, o: FormatOptions = DEFAULT_FORMAT, decimals = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–'
  return new Intl.NumberFormat(o.locale, { style: 'currency', currency: o.currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n)
}

export function formatNumber(n: number | null | undefined, decimals = 2, locale = DEFAULT_FORMAT.locale): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–'
  return new Intl.NumberFormat(locale, { maximumFractionDigits: decimals, minimumFractionDigits: 0 }).format(n)
}

export function formatKwh(n: number, locale = DEFAULT_FORMAT.locale): string {
  return `${formatNumber(n, 3, locale)} kWh`
}

/** Pris per kWh vises i øre for lesbarhet. */
export function formatOre(krPerKwh: number | null | undefined, locale = DEFAULT_FORMAT.locale): string {
  if (krPerKwh === null || krPerKwh === undefined || !Number.isFinite(krPerKwh)) return '–'
  return `${formatNumber(krPerKwh * 100, 1, locale)} øre/kWh`
}

export function formatPercent(n: number | null | undefined, locale = DEFAULT_FORMAT.locale): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–'
  return `${formatNumber(n, 1, locale)} %`
}

export function formatTime(iso: string, locale = DEFAULT_FORMAT.locale): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

export function formatDate(iso: string, locale = DEFAULT_FORMAT.locale): string {
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(iso: string, locale = DEFAULT_FORMAT.locale): string {
  return new Date(iso).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Lokal dato som YYYY-MM-DD (ikke UTC). */
export function toLocalDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Tolker norsk tallformat i input (komma som desimaltegn). */
export function parseNumber(v: string): number {
  const n = Number(v.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
