import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase, isSupabaseConfigured } from '../lib/supabase'
import { effectivePlan } from '../lib/plans'
import { signOut as authSignOut } from '../services/auth'
import { dbErrorMessage } from '../services/storage/mappers'
import { navigate } from '../hooks/useRoute'
import { AuthContext, type AuthValue, type MyContext } from './authContext'

/** Leser og fjerner ?auth=... fra adressen (etter at Supabase har byttet ?code mot sesjon). */
function takeAuthParam(): string | null {
  const url = new URL(window.location.href)
  const v = url.searchParams.get('auth')
  if (v || url.searchParams.has('code')) {
    url.searchParams.delete('auth')
    url.searchParams.delete('code')
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  }
  return v
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => getSupabase(), [])
  const configured = isSupabaseConfigured()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(configured)
  const [context, setContext] = useState<MyContext | null>(null)
  const [contextError, setContextError] = useState<string | null>(null)
  const [recovery, setRecovery] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    if (!client) return
    let alive = true
    client.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      const param = takeAuthParam()
      if (param === 'recovery') { setRecovery(true); navigate('tilbakestill-passord') }
      if (param === 'confirmed') { setFlash('E-postadressen er bekreftet. Velkommen!'); navigate('konto') }
      setLoading(false)
    })
    const { data: sub } = client.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') { setRecovery(true); navigate('tilbakestill-passord') }
      if (event === 'SIGNED_OUT') { setContext(null); setRecovery(false) }
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [client])

  const userId = session?.user.id ?? null

  /** Henter profil, organisasjoner og abonnement (ren funksjon – setter ikke state). */
  const fetchContext = useCallback(async (): Promise<MyContext | null> => {
    if (!client || !userId) return null
    const { data, error } = await client.rpc('get_my_context')
    if (error) throw new Error(dbErrorMessage(error))
    return data as MyContext
  }, [client, userId])

  const loadContext = useCallback(async () => {
    try {
      setContext(await fetchContext())
      setContextError(null)
    } catch (e) {
      setContextError(e instanceof Error ? e.message : 'Kunne ikke hente konto.')
    }
  }, [fetchContext])

  useEffect(() => {
    if (!userId) return
    let alive = true
    fetchContext()
      .then((c) => { if (alive) { setContext(c); setContextError(null) } })
      .catch((e: unknown) => { if (alive) setContextError(e instanceof Error ? e.message : 'Kunne ikke hente konto.') })
    return () => { alive = false }
  }, [userId, fetchContext])

  const value = useMemo<AuthValue>(() => {
    const ctx = userId ? context : null
    const orgs = ctx?.organizations ?? []
    const activeOrg = orgs.find((o) => o.id === ctx?.settings?.active_organization_id) ?? orgs[0] ?? null
    const plan = activeOrg ? (activeOrg.subscription?.effective_plan ?? effectivePlan(activeOrg.subscription)) : 'free'
    return {
      configured,
      client,
      session,
      user: session?.user ?? null,
      loading: loading || (!!userId && !ctx && !contextError),
      context: ctx,
      contextError,
      activeOrg,
      plan,
      isAdmin: !!ctx?.is_system_admin,
      recovery,
      clearRecovery: () => setRecovery(false),
      flash,
      clearFlash: () => setFlash(null),
      refresh: loadContext,
      setActiveOrg: async (id: string) => {
        if (!client || !userId) return
        const { error } = await client.from('user_settings').update({ active_organization_id: id }).eq('user_id', userId)
        if (error) throw new Error(dbErrorMessage(error))
        await loadContext()
      },
      signOut: async () => {
        if (!client) return
        await authSignOut(client)
        setContext(null)
        navigate('oversikt')
      },
    }
  }, [configured, client, session, userId, loading, context, contextError, recovery, flash, loadContext])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
