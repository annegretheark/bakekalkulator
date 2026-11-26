import type { ReactNode } from 'react'
import { useData } from '../hooks/useData'
import { usePrices } from '../hooks/usePrices'
import { PricesContext } from './pricesContext'

/** Én felles henting av strømpriser for hele appen. */
export function PricesProvider({ children }: { children: ReactNode }) {
  const { data } = useData()
  const prices = usePrices(data.settings.price.area, data.settings.price)
  return <PricesContext.Provider value={prices}>{children}</PricesContext.Provider>
}
