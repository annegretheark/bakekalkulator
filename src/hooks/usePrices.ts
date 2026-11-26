import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PriceArea, PriceInterval, PriceSettings } from '../types'
import { fetchPrices, osloDateKey, PriceApiError } from '../services/priceApi'
import { calculatePrice, effectiveMode, intervalAt, priceIntervals, type PricedInterval } from '../utils/electricity'

interface DayState {
  intervals: PriceInterval[]
  error: string | null
  notPublished: boolean
}

const EMPTY: DayState = { intervals: [], error: null, notPublished: false }

export interface PricesState {
  loading: boolean
  today: DayState
  tomorrow: DayState
  /** Priser for i dag + i morgen med alle tillegg, sortert. */
  priced: PricedInterval[]
  current: PricedInterval | undefined
  /** Effektiv pris per kWh nå (spot inkl. tillegg, eller fast/manuell pris). */
  currentTotal: number | null
  todayAverage: number | null
  reload: () => void
  now: Date
}

function toState(r: PromiseSettledResult<PriceInterval[]>): DayState {
  if (r.status === 'fulfilled') return { intervals: r.value, error: null, notPublished: false }
  const e = r.reason
  if (e instanceof PriceApiError && e.kind === 'not-available') return { intervals: [], error: e.message, notPublished: true }
  return { intervals: [], error: e instanceof Error ? e.message : 'Ukjent feil ved henting av priser.', notPublished: false }
}

export function usePrices(area: PriceArea, settings: PriceSettings): PricesState {
  const [state, setState] = useState<{ today: DayState; tomorrow: DayState; key: string }>({ today: EMPTY, tomorrow: EMPTY, key: '' })
  const [now, setNow] = useState(() => new Date())
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const todayKey = osloDateKey(now)
  const tomorrowKey = osloDateKey(new Date(now.getTime() + 86_400_000))
  const requestKey = `${area}|${todayKey}|${nonce}`

  useEffect(() => {
    let alive = true
    Promise.allSettled([fetchPrices(todayKey, area), fetchPrices(tomorrowKey, area)]).then(([t, m]) => {
      if (alive) setState({ today: toState(t), tomorrow: toState(m), key: requestKey })
    })
    return () => { alive = false }
  }, [area, todayKey, tomorrowKey, requestKey])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return useMemo(() => {
    const all = [...state.today.intervals, ...state.tomorrow.intervals]
    const priced = priceIntervals(all, settings).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    const current = intervalAt(priced, now)
    const usesSpot = effectiveMode(settings) === 'spot'
    const todayPriced = priceIntervals(state.today.intervals, settings)
    const fixedTotal = calculatePrice(settings, null).total
    const todayAverage = usesSpot
      ? (todayPriced.length ? todayPriced.reduce((s, p) => s + p.totalPerKwh, 0) / todayPriced.length : null)
      : fixedTotal
    return {
      loading: state.key !== requestKey,
      today: state.today,
      tomorrow: state.tomorrow,
      priced,
      current,
      currentTotal: usesSpot ? (current?.totalPerKwh ?? null) : fixedTotal,
      todayAverage,
      reload,
      now,
    }
  }, [state, settings, now, requestKey, reload])
}
