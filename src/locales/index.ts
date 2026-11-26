import { nb, type Dictionary, type TranslationKey } from './nb'

export type { TranslationKey } from './nb'

/** Registrerte språk. Legg til f.eks. `en: en` og `sv: sv` når oversettelser finnes. */
const dictionaries: Record<string, Dictionary> = { 'nb-NO': nb }

export const SUPPORTED_LOCALES = Object.keys(dictionaries)

export function translate(locale: string, key: TranslationKey): string {
  return (dictionaries[locale] ?? nb)[key] ?? key
}
