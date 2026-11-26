import { useContext } from 'react'
import { DataContext } from '../context/dataContext'
import { translate, type TranslationKey } from '../locales'
import type { FormatOptions } from '../utils/format'

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData må brukes innenfor <DataProvider>')
  return ctx
}

/** Oversettelse basert på brukerens språkvalg. */
export function useT() {
  const { data } = useData()
  return (key: TranslationKey) => translate(data.settings.locale, key)
}

export function useFormat(): FormatOptions {
  const { data } = useData()
  return { locale: data.settings.locale, currency: data.settings.currency }
}
