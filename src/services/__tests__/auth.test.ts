import { describe, expect, it, vi } from 'vitest'
import {
  authErrorMessage, requestPasswordReset, signIn, signOut, signUp, updatePassword, validatePassword, validateRegistration,
  type AuthClient, type RegistrationInput,
} from '../auth'
import { assertPublicKey } from '../../lib/supabase'

function fakeClient(overrides: Partial<AuthClient['auth']> = {}): AuthClient {
  return {
    auth: {
      signUp: vi.fn(async () => ({ data: { session: null, user: { id: 'u1' } }, error: null })),
      signInWithPassword: vi.fn(async () => ({ data: { session: {} }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      resetPasswordForEmail: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ error: null })),
      resend: vi.fn(async () => ({ error: null })),
      ...overrides,
    },
  }
}

const valid: RegistrationInput = {
  fullName: 'Kari Baker', email: 'Kari@Example.no', password: 'brodbaker1', passwordConfirm: 'brodbaker1',
  accountType: 'business', organizationName: 'Karis Bakeri', acceptTerms: true, acceptPrivacy: true,
}

describe('registrering', () => {
  it('validerer navn, e-post, passord, firmanavn og vilkår', () => {
    expect(validateRegistration(valid)).toEqual({})
    const e = validateRegistration({ ...valid, fullName: ' ', email: 'x', password: 'kort', organizationName: '', acceptTerms: false, acceptPrivacy: false })
    expect(Object.keys(e).sort()).toEqual(['acceptPrivacy', 'acceptTerms', 'email', 'fullName', 'organizationName', 'password'])
  })

  it('privatperson trenger ikke firmanavn', () => {
    expect(validateRegistration({ ...valid, accountType: 'private', organizationName: '' })).toEqual({})
  })

  it('passordregler', () => {
    expect(validatePassword('abc12345')).toBeNull()
    expect(validatePassword('abcdefgh')).toMatch(/bokstaver og tall/)
    expect(validatePassword('abc1234')).toMatch(/minst 8/)
    expect(validatePassword('abc12345', 'abc12346')).toMatch(/ikke like/)
  })

  it('sender metadata som serveren bruker til å opprette profil og organisasjon', async () => {
    const c = fakeClient()
    const r = await signUp(c, valid, 'https://app.example')
    expect(r.needsConfirmation).toBe(true)
    expect(c.auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: 'kari@example.no',
      options: expect.objectContaining({
        emailRedirectTo: 'https://app.example/?auth=confirmed',
        data: expect.objectContaining({ full_name: 'Kari Baker', account_type: 'business', organization_name: 'Karis Bakeri', terms_version: '2026-11-26-utkast', privacy_version: '2026-11-26-utkast' }),
      }),
    }))
  })

  it('privatperson sender ikke organisasjonsnavn', async () => {
    const c = fakeClient()
    await signUp(c, { ...valid, accountType: 'private' }, 'https://app.example')
    const arg = (c.auth.signUp as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.options.data.organization_name).toBeNull()
  })

  it('kaller ikke Supabase ved ugyldige data', async () => {
    const c = fakeClient()
    await expect(signUp(c, { ...valid, acceptTerms: false }, 'https://x')).rejects.toThrow(/vilkårene/)
    expect(c.auth.signUp).not.toHaveBeenCalled()
  })

  it('oversetter «finnes allerede»', async () => {
    const c = fakeClient({ signUp: vi.fn(async () => ({ data: { session: null, user: null }, error: { message: 'User already registered' } })) })
    await expect(signUp(c, valid, 'https://x')).rejects.toThrow(/finnes allerede/)
  })
})

describe('innlogging og utlogging', () => {
  it('logger inn med normalisert e-post', async () => {
    const c = fakeClient()
    await signIn(c, ' Kari@Example.no ', 'hemmelig1')
    expect(c.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'kari@example.no', password: 'hemmelig1' })
  })

  it('gir norske feilmeldinger', async () => {
    const bad = fakeClient({ signInWithPassword: vi.fn(async () => ({ data: { session: null }, error: { message: 'Invalid login credentials' } })) })
    await expect(signIn(bad, 'a@b.no', 'x')).rejects.toThrow('Feil e-post eller passord.')
    const unconfirmed = fakeClient({ signInWithPassword: vi.fn(async () => ({ data: { session: null }, error: { message: 'Email not confirmed' } })) })
    await expect(signIn(unconfirmed, 'a@b.no', 'x')).rejects.toThrow(/ikke bekreftet/)
  })

  it('logger ut', async () => {
    const c = fakeClient()
    await signOut(c)
    expect(c.auth.signOut).toHaveBeenCalled()
  })
})

describe('glemt og tilbakestilling av passord', () => {
  it('sender lenke med riktig adresse og avslører ikke om kontoen finnes', async () => {
    const c = fakeClient({ resetPasswordForEmail: vi.fn(async () => ({ error: { message: 'User not found' } })) })
    await expect(requestPasswordReset(c, 'ukjent@example.no', 'https://app.example')).resolves.toBeUndefined()
    expect(c.auth.resetPasswordForEmail).toHaveBeenCalledWith('ukjent@example.no', { redirectTo: 'https://app.example/?auth=recovery' })
  })

  it('oppdaterer passord kun når det er gyldig', async () => {
    const c = fakeClient()
    await expect(updatePassword(c, 'kort', 'kort')).rejects.toThrow()
    expect(c.auth.updateUser).not.toHaveBeenCalled()
    await updatePassword(c, 'nyttpass9', 'nyttpass9')
    expect(c.auth.updateUser).toHaveBeenCalledWith({ password: 'nyttpass9' })
  })

  it('feilmelding ved ukjent feil faller tilbake til originalen', () => {
    expect(authErrorMessage({ message: 'Noe rart' })).toBe('Noe rart')
  })
})

describe('nøkler i frontend', () => {
  it('avviser hemmelige nøkler', () => {
    expect(() => assertPublicKey('sb_secret_abc')).toThrow(/Hemmelig/)
    const payload = btoa(JSON.stringify({ role: 'service_role' })).replace(/=+$/, '')
    expect(() => assertPublicKey(`eyJhbGciOiJIUzI1NiJ9.${payload}.sig`)).toThrow(/service_role/)
  })
  it('godtar offentlige nøkler', () => {
    expect(() => assertPublicKey('sb_publishable_abc')).not.toThrow()
    const payload = btoa(JSON.stringify({ role: 'anon' })).replace(/=+$/, '')
    expect(() => assertPublicKey(`eyJhbGciOiJIUzI1NiJ9.${payload}.sig`)).not.toThrow()
  })
})
