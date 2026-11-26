import { createContext } from 'react'
import type { PricesState } from '../hooks/usePrices'

export const PricesContext = createContext<PricesState | null>(null)
