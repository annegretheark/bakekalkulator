import { businessProfile } from '../lib/businessTypes'
import { useData } from './useData'

/** Virksomhetstype og tilpassede ord/meny for aktiv organisasjon (eller lokal modus). */
export function useBusiness() {
  const { data } = useData()
  const type = data.settings.businessType
  return { type, profile: businessProfile(type) }
}
