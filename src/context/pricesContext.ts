import { createContext } from 'react'
import type { PricesState } from '../hooks/usePrices'
import type { PriceSettings, Tariff } from '../types'

export interface PricesContextValue extends PricesState {
  /** Prisoppsett etter at gjeldende offentlige satser er lagt inn. Brukes i alle beregninger. */
  effectiveSettings: PriceSettings
  /** Advarsler om manglende/utløpte satser som ikke er brukt. */
  tariffWarnings: string[]
  /** Offentlige satser som faktisk er brukt i beregningen. */
  tariffsUsed: Tariff[]
  /** Alle kjente satser (også utløpte – kun til visning). */
  tariffs: Tariff[]
  tariffSource: 'database' | 'lokal'
}

export const PricesContext = createContext<PricesContextValue | null>(null)
