import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useData } from '../hooks/useData'
import { useAuth } from '../hooks/useAuth'
import { usePrices } from '../hooks/usePrices'
import { LOCAL_TARIFFS } from '../lib/tariffs'
import { osloDateKey } from '../services/priceApi'
import { tariffFromRow, type TariffRow } from '../services/storage/mappers'
import { applyTariffs } from '../utils/tariffs'
import type { Tariff } from '../types'
import { PricesContext, type PricesContextValue } from './pricesContext'

/**
 * Én felles henting av strømpriser og offentlige satser for hele appen.
 * Satsene hentes fra databasen (electricity_tariffs) når Supabase er satt opp,
 * ellers brukes den lokale kopien. Utløpte satser brukes ikke automatisk.
 */
export function PricesProvider({ children }: { children: ReactNode }) {
  const { data } = useData()
  const { client } = useAuth()
  const [remote, setRemote] = useState<Tariff[] | null>(null)

  useEffect(() => {
    if (!client) return
    let alive = true
    client.from('electricity_tariffs').select('*').order('valid_from', { ascending: false }).then(({ data: rows, error }) => {
      if (alive && !error && rows) setRemote((rows as TariffRow[]).map(tariffFromRow))
    })
    return () => { alive = false }
  }, [client])

  const tariffs = remote ?? LOCAL_TARIFFS
  const today = osloDateKey(new Date())
  const applied = useMemo(() => applyTariffs(data.settings.price, tariffs, today), [data.settings.price, tariffs, today])
  const prices = usePrices(applied.settings.area, applied.settings)

  const value = useMemo<PricesContextValue>(() => ({
    ...prices,
    effectiveSettings: applied.settings,
    tariffWarnings: applied.warnings,
    tariffsUsed: applied.used,
    tariffs,
    tariffSource: remote ? 'database' : 'lokal',
  }), [prices, applied, tariffs, remote])

  return <PricesContext.Provider value={value}>{children}</PricesContext.Provider>
}
