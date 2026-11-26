import type { Tariff } from '../types'

/**
 * Lokal kopi av offentlige satser, identisk med seed-dataene i
 * supabase/migrations/20261126120300_reference_data.sql.
 * Kontrollert mot primærkildene (Lovdata, Stortinget) 2026-11-26.
 * Foreslåtte, ikke vedtatte satser (2027) er bevisst utelatt.
 * Brukes når appen kjører uten Supabase eller satsene ikke kan hentes.
 * Utløpte satser brukes ikke automatisk (se utils/tariffs.ts).
 */
export const LOCAL_TARIFFS: Tariff[] = [
  {
    code: 'norgespris', description: 'Norgespris (referansepris for husholdninger)', value: 0.4, unit: 'kr/kWh eks. mva',
    area: null, customerType: 'privat', validFrom: '2025-10-01', validTo: '2026-12-31',
    sourceUrl: 'https://lovdata.no/dokument/SF/forskrift/2025-09-08-1790',
    verifiedAt: '2026-11-26', notes: '§ 10. Gjelder husholdning og fritidsbolig. Forbrukstak § 13: 5 000 kWh/mnd (husholdning), 1 000 kWh/mnd (fritidsbolig).',
  },
  {
    code: 'stromstotte_terskel', description: 'Strømstøtte – terskelverdi', value: 0.77, unit: 'kr/kWh eks. mva',
    area: null, customerType: 'privat', validFrom: '2026-01-01', validTo: '2026-12-31',
    sourceUrl: 'https://lovdata.no/dokument/SF/forskrift/2025-09-08-1791',
    verifiedAt: '2026-11-26', notes: '§ 5. Første 5 000 kWh per måned per målepunkt. Ikke sammen med Norgespris. Ingen verdi fastsatt for 2027.',
  },
  {
    code: 'stromstotte_dekning', description: 'Strømstøtte – stønadsgrad', value: 90, unit: 'prosent',
    area: null, customerType: 'privat', validFrom: '2026-01-01', validTo: '2026-12-31',
    sourceUrl: 'https://lovdata.no/dokument/SF/forskrift/2025-09-08-1791',
    verifiedAt: '2026-11-26', notes: '§ 5. Andel av spotpris over terskelverdien som dekkes.',
  },
  {
    code: 'elavgift', description: 'Elavgift – alminnelig sats', value: 0.0713, unit: 'kr/kWh eks. mva',
    area: null, customerType: null, validFrom: '2026-01-01', validTo: '2026-12-31',
    sourceUrl: 'https://www.stortinget.no/no/Saker-og-publikasjoner/Vedtak/Vedtak/Sak/?did=40035803&p=104911',
    verifiedAt: '2026-11-26', notes: 'Fritak for husholdninger og offentlig forvaltning i tiltakssonen (Finnmark, Karlsøy, Kvænangen, Kåfjord, Lyngen, Nordreisa, Skjervøy og Storfjord). Annen bruk der: 0,6 øre/kWh. Tiltakssonen følger ikke prisområdene og må velges av brukeren.',
  },
]

export const TARIFF_CODES = {
  norgespris: 'norgespris',
  subsidyThreshold: 'stromstotte_terskel',
  subsidyCoverage: 'stromstotte_dekning',
  electricityTax: 'elavgift',
} as const
