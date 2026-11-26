/**
 * Gjeldende dokumentversjoner. Må samsvare med legal_documents (is_current) i
 * databasen – serveren registrerer kun godkjenning av gjeldende versjon, med servertid.
 */
export const LEGAL_VERSIONS = {
  terms: '2026-11-26-utkast',
  privacy: '2026-11-26-utkast',
} as const

export type LegalDocument = keyof typeof LEGAL_VERSIONS
