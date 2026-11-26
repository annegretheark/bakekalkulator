// Enhetstester for frontend-delen av sikkerhetsrettelsene (runde 3).
import { describe, expect, it, vi } from 'vitest'
import { reauthenticate, signUp, type AuthClient } from '../auth'
import { buildImportPayload } from '../importLocal'
import { dbErrorMessage, ingredientToRpc, tariffFromRow } from '../storage/mappers'
import { activeTariff, applyTariffs, isTariffUsable } from '../../utils/tariffs'
import { LOCAL_TARIFFS } from '../../lib/tariffs'
import { LEGAL_VERSIONS } from '../../lib/legal'
import { defaultPriceSettings } from '../../lib/defaults'
import { seedData } from '../../lib/seed'
import type { Tariff } from '../../types'

type SignIn = AuthClient['auth']['signInWithPassword']
const fake = (signIn: SignIn = vi.fn(async () => ({ data: { session: {} }, error: null }))): AuthClient => ({
  auth: {
    signUp: vi.fn(async () => ({ data: { session: null, user: null }, error: null })),
    signInWithPassword: signIn,
    signOut: vi.fn(async () => ({ error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ error: null })),
    updateUser: vi.fn(async () => ({ error: null })),
    resend: vi.fn(async () => ({ error: null })),
  },
})

describe('ny innlogging før kontosletting', () => {
  it('logger inn på nytt med passord (gir ferskt amr i JWT)', async () => {
    const c = fake()
    await reauthenticate(c, 'Kari@Example.no', 'hemmelig1')
    expect(c.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'kari@example.no', password: 'hemmelig1' })
  })
  it('feil passord stopper slettingen', async () => {
    const c = fake(vi.fn(async () => ({ data: { session: null }, error: { message: 'Invalid login credentials' } })) as SignIn)
    await expect(reauthenticate(c, 'a@b.no', 'feil')).rejects.toThrow('Feil e-post eller passord.')
  })
  it('krever passord', async () => {
    await expect(reauthenticate(fake(), 'a@b.no', '')).rejects.toThrow(/passordet/)
  })
  it('serverfeil for manglende ny innlogging blir lesbar', () => {
    expect(dbErrorMessage({ message: 'REAUTH_REQUIRED: Logg inn på nytt med passord for å bekrefte slettingen.' })).toMatch(/Logg inn på nytt/)
    expect(dbErrorMessage({ message: 'IMMUTABLE: Feltet organization_id kan ikke endres.' })).toMatch(/organization_id/)
  })
})

describe('godkjenning av vilkår og personvern', () => {
  it('sender kun dokumentversjoner – ikke tidspunkt', async () => {
    const c = fake()
    await signUp(c, { fullName: 'K', email: 'k@k.no', password: 'abcd1234', passwordConfirm: 'abcd1234', accountType: 'private', organizationName: '', acceptTerms: true, acceptPrivacy: true }, 'https://x')
    const data = (c.auth.signUp as ReturnType<typeof vi.fn>).mock.calls[0][0].options.data
    expect(data.terms_version).toBe(LEGAL_VERSIONS.terms)
    expect(data.privacy_version).toBe(LEGAL_VERSIONS.privacy)
    expect(Object.keys(data).some((k) => k.includes('_at'))).toBe(false)
  })
})

describe('import', () => {
  it('utelater rader uten gyldig lokal id', () => {
    const d = seedData()
    d.ingredients.push({ ...d.ingredients[0], id: '  ' }, { ...d.ingredients[0], id: 'x'.repeat(101) })
    d.recipes.push({ ...d.recipes[0], id: '' })
    const p = buildImportPayload(d)
    expect(p.ingredients.every((i) => i.local_id.trim().length > 0 && i.local_id.length <= 100)).toBe(true)
    expect(p.ingredients).toHaveLength(10)
    expect(p.recipes).toHaveLength(1)
  })
})

describe('ingredienser lagres uten organization_id i radendringen', () => {
  it('RPC-argumentet inneholder ikke organization_id eller created_by', () => {
    const arg = ingredientToRpc(seedData().ingredients[0])
    expect(arg).not.toHaveProperty('organization_id')
    expect(arg).not.toHaveProperty('created_by')
  })
})

describe('ikke-verifiserte satser', () => {
  const unverified: Tariff = { ...LOCAL_TARIFFS[0], verifiedAt: null }

  it('brukes ikke automatisk selv om de er gyldige på datoen', () => {
    expect(isTariffUsable(unverified, '2026-11-26')).toBe(false)
    expect(activeTariff([unverified], 'norgespris', { date: '2026-11-26', area: 'NO1', customerType: 'privat' })).toBeNull()
    const r = applyTariffs({ ...defaultPriceSettings('NO1'), customerType: 'privat', mode: 'norgespris' }, [unverified], '2026-11-26')
    expect(r.settings.mode).toBe('manuell')
    expect(r.warnings.length).toBe(1)
  })

  it('verified_at = null fra databasen tolkes riktig', () => {
    const t = tariffFromRow({ id: '1', code: 'x', description: 'x', value: '1', unit: 'kr', area: null, customer_type: null, valid_from: '2026-01-01', valid_to: null, source_url: 'https://x', verified_at: null, notes: null })
    expect(t.verifiedAt).toBeNull()
  })

  it('lokale satser peker på primærkilder og har ingen foreslåtte 2027-satser', () => {
    expect(LOCAL_TARIFFS.every((t) => t.verifiedAt === '2026-11-26')).toBe(true)
    expect(LOCAL_TARIFFS.every((t) => t.validFrom < '2027-01-01')).toBe(true)
    expect(LOCAL_TARIFFS.every((t) => /^https:\/\/(lovdata\.no|www\.stortinget\.no)\//.test(t.sourceUrl))).toBe(true)
  })
})
