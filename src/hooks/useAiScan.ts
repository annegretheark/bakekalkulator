import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { useOnline } from './useOnline'
import { AiScanError, aiScan, getAiStatus, type AiResult, type AiStatus, type ScanKind } from '../services/aiScan'

const OFF: AiStatus = { enabled: false, used: 0, limit: 0, resetsAt: null }

/**
 * AI-tolkning for aktiv organisasjon. Bare tilgjengelig for innloggede brukere
 * når systemadministrator har slått den på, og så lenge kvoten ikke er brukt opp.
 * Kvoten håndheves på serveren – tallene her er bare til visning.
 */
export function useAiScan() {
  const auth = useAuth()
  const client = auth.client
  const org = auth.activeOrg?.id ?? null
  const online = useOnline()
  const [status, setStatus] = useState<AiStatus>(OFF)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    if (!client || !org) return
    getAiStatus(client, org).then((s) => { if (alive) setStatus(s) }).catch(() => {})
    return () => { alive = false }
  }, [client, org])

  const run = useCallback(async (kind: ScanKind, file: Blob): Promise<AiResult | null> => {
    if (!client || !org) return null
    setBusy(true)
    setError(null)
    try {
      const { result, quota } = await aiScan(client, org, kind, file)
      setStatus((s) => ({ ...s, used: quota.used || s.used + 1, limit: quota.limit || s.limit }))
      return result
    } catch (e) {
      setError(e instanceof AiScanError ? e.message : 'AI-tolkningen feilet. Prøv igjen.')
      if (e instanceof AiScanError && (e.code === 'QUOTA_EXCEEDED' || e.code === 'AI_DISABLED' || e.code === 'COST_LIMIT')) {
        getAiStatus(client, org).then(setStatus).catch(() => {})
      }
      return null
    } finally {
      setBusy(false)
    }
  }, [client, org])

  const active = !!client && !!org && status.enabled
  return {
    /** AI er slått på for tjenesten og brukeren er innlogget. */
    active,
    /** Kan brukes nå (på nett, slått på og kvote igjen). Uten nett virker tekstgjenkjenning på telefonen. */
    available: active && online && status.used < status.limit,
    status, busy, error, run,
    clearError: () => setError(null),
  }
}
