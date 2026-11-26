import { useContext, useMemo } from 'react'
import { PricesContext } from '../context/pricesContext'
import type { EnergyInput } from '../types'
import { ovenLoadProfile } from '../utils/energy'
import { findCheapestWindow } from '../utils/electricity'

export function usePriceData() {
  const ctx = useContext(PricesContext)
  if (!ctx) throw new Error('usePriceData må brukes innenfor <PricesProvider>')
  return ctx
}

/** Billigste gjenværende starttidspunkt for ovnens profil (forvarming + steking). */
export function useCheapestWindow(energy: EnergyInput) {
  const { priced, now } = usePriceData()
  return useMemo(() => {
    const profile = ovenLoadProfile(energy)
    // Start tidligst ved inneværende intervall slik at "nå" er en gyldig kandidat
    const from = new Date(now)
    from.setMinutes(Math.floor(from.getMinutes() / 15) * 15, 0, 0)
    return { window: findCheapestWindow(priced, profile, from), profile }
  }, [energy, priced, now])
}
