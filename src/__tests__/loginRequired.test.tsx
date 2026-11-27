// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import App from '../App'
import { PUBLIC_ROUTES, ROUTES, requiresLogin } from '../hooks/useRoute'

// Spørringer mot den falske klienten gir alltid et tomt svar
const emptyQuery = (): unknown => new Proxy(() => {}, {
  get: (_t, prop) => (prop === 'then' ? (ok: (v: unknown) => void) => ok({ data: [], error: null }) : emptyQuery()),
  apply: () => emptyQuery(),
})
const fakeClient = { auth: {}, from: () => emptyQuery(), rpc: () => emptyQuery() }

// Simulerer at Supabase er satt opp, men at ingen er innlogget
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    configured: true, client: fakeClient, session: null, user: null, loading: false,
    context: null, contextError: null, activeOrg: null, plan: 'free', isAdmin: false,
    recovery: false, clearRecovery: () => {}, flash: null, clearFlash: () => {}, refresh: async () => {}, setActiveOrg: async () => {}, signOut: async () => {},
  }),
}))

beforeAll(() => {
  vi.stubEnv('VITE_SUPABASE_URL', '')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  window.scrollTo = () => {}
})
afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

const go = async (r: string) => act(async () => { window.location.hash = `/${r}`; window.dispatchEvent(new HashChangeEvent('hashchange')) })

describe('innlogging kreves når Supabase er satt opp', () => {
  it('alle hovedsider krever innlogging; innlogging, registrering og juridiske sider er åpne', () => {
    for (const r of ROUTES) expect(requiresLogin(r)).toBe(true)
    expect(requiresLogin('konto')).toBe(true)
    expect(requiresLogin('admin')).toBe(true)
    for (const r of PUBLIC_ROUTES) expect(requiresLogin(r)).toBe(false)
  })

  it('viser innlogging i stedet for appen, og skjuler menyen', async () => {
    render(<App />)
    for (const r of ['oversikt', 'kalkulator', 'oppskrifter', 'ingredienser']) {
      await go(r)
      expect(await screen.findByRole('heading', { level: 1, name: 'Logg inn' })).toBeTruthy()
      expect(screen.queryByRole('heading', { level: 1, name: /Bakekalkulator|Mine oppskrifter|God dag/ })).toBeNull()
    }
    expect(screen.queryByRole('link', { name: /Ingredienser/ })).toBeNull()
    expect(screen.getByRole('link', { name: /Opprett konto/ })).toBeTruthy()

    await go('personvern')
    expect(screen.queryByRole('heading', { level: 1, name: 'Logg inn' })).toBeNull()
  })
})
