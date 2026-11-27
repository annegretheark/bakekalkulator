/**
 * Autentisering via Supabase Auth. Klienten sendes inn, slik at funksjonene kan testes.
 *
 * Registrering sender navn, kontotype og organisasjonsnavn som metadata.
 * Databasetriggeren public.handle_new_user oppretter profil, organisasjon,
 * medlemskap og prøveabonnement atomisk på serversiden.
 */

import { LEGAL_VERSIONS } from '../lib/legal'
import type { BusinessType } from '../types'

export type AccountType = 'private' | 'business'

export interface RegistrationInput {
  fullName: string
  email: string
  password: string
  passwordConfirm: string
  accountType: AccountType
  /** Virksomhetstype for bedrifter. Privatpersoner får alltid «privat». Mangler = «annet». */
  businessType?: BusinessType
  organizationName: string
  acceptTerms: boolean
  acceptPrivacy: boolean
}

export const MIN_PASSWORD_LENGTH = 8

/** Minimalt grensesnitt mot supabase.auth – gjør det enkelt å teste med en falsk klient. */
export interface AuthClient {
  auth: {
    signUp: (args: { email: string; password: string; options?: { data?: Record<string, unknown>; emailRedirectTo?: string } }) =>
      Promise<{ data: { session: unknown | null; user: unknown | null }; error: { message: string; code?: string } | null }>
    signInWithPassword: (args: { email: string; password: string }) =>
      Promise<{ data: { session: unknown | null }; error: { message: string; code?: string } | null }>
    signOut: () => Promise<{ error: { message: string } | null }>
    resetPasswordForEmail: (email: string, opts?: { redirectTo?: string }) => Promise<{ error: { message: string; code?: string } | null }>
    updateUser: (attrs: { password?: string }) => Promise<{ error: { message: string; code?: string } | null }>
    resend: (args: { type: 'signup'; email: string; options?: { emailRedirectTo?: string } }) => Promise<{ error: { message: string } | null }>
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim())
}

export function validatePassword(pw: string, confirm?: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return `Passordet må ha minst ${MIN_PASSWORD_LENGTH} tegn.`
  if (!/[A-Za-zÆØÅæøå]/.test(pw) || !/\d/.test(pw)) return 'Passordet må inneholde både bokstaver og tall.'
  if (confirm !== undefined && pw !== confirm) return 'Passordene er ikke like.'
  return null
}

export function validateRegistration(i: RegistrationInput): Partial<Record<keyof RegistrationInput, string>> {
  const e: Partial<Record<keyof RegistrationInput, string>> = {}
  if (!i.fullName.trim()) e.fullName = 'Skriv inn navnet ditt.'
  else if (i.fullName.trim().length > 200) e.fullName = 'Navnet er for langt.'
  if (!isValidEmail(i.email)) e.email = 'Skriv inn en gyldig e-postadresse.'
  const pw = validatePassword(i.password, i.passwordConfirm)
  if (pw) e.password = pw
  if (i.accountType === 'business' && !i.organizationName.trim()) e.organizationName = 'Skriv inn firmanavn.'
  if (!i.acceptTerms) e.acceptTerms = 'Du må godta brukervilkårene.'
  if (!i.acceptPrivacy) e.acceptPrivacy = 'Du må bekrefte at du har lest personvernerklæringen.'
  return e
}

/** Oversetter vanlige feil fra Supabase Auth til norsk. */
export function authErrorMessage(err: { message?: string; code?: string } | null | undefined): string {
  if (!err) return 'Ukjent feil.'
  const m = `${err.code ?? ''} ${err.message ?? ''}`.toLowerCase()
  if (m.includes('invalid login credentials') || m.includes('invalid_credentials')) return 'Feil e-post eller passord.'
  if (m.includes('email not confirmed') || m.includes('email_not_confirmed')) return 'E-postadressen er ikke bekreftet. Sjekk innboksen din.'
  if (m.includes('already registered') || m.includes('user_already_exists')) return 'Det finnes allerede en konto med denne e-postadressen.'
  if (m.includes('rate limit') || m.includes('over_email_send_rate_limit') || m.includes('too many')) return 'For mange forsøk. Vent litt og prøv igjen.'
  if (m.includes('weak') || m.includes('password should')) return 'Passordet er for svakt.'
  if (m.includes('same_password') || m.includes('different from the old')) return 'Det nye passordet må være forskjellig fra det gamle.'
  if (m.includes('fetch') || m.includes('network')) return 'Fikk ikke kontakt med serveren. Sjekk nettforbindelsen.'
  return err.message || 'Noe gikk galt.'
}

export const authRedirects = (origin: string) => ({
  confirmed: `${origin}/?auth=confirmed`,
  recovery: `${origin}/?auth=recovery`,
})

export async function signUp(client: AuthClient, i: RegistrationInput, origin: string): Promise<{ needsConfirmation: boolean }> {
  const errors = validateRegistration(i)
  const first = Object.values(errors)[0]
  if (first) throw new Error(first)
  const { data, error } = await client.auth.signUp({
    email: i.email.trim().toLowerCase(),
    password: i.password,
    options: {
      emailRedirectTo: authRedirects(origin).confirmed,
      data: {
        full_name: i.fullName.trim(),
        account_type: i.accountType,
        business_type: i.accountType === 'business' ? (i.businessType && i.businessType !== 'privat' ? i.businessType : 'annet') : 'privat',
        organization_name: i.accountType === 'business' ? i.organizationName.trim() : null,
        // Kun versjoner sendes – serveren registrerer godkjenningene med servertid
        terms_version: i.acceptTerms ? LEGAL_VERSIONS.terms : null,
        privacy_version: i.acceptPrivacy ? LEGAL_VERSIONS.privacy : null,
      },
    },
  })
  if (error) throw new Error(authErrorMessage(error))
  return { needsConfirmation: !data.session }
}

export async function signIn(client: AuthClient, email: string, password: string): Promise<void> {
  if (!isValidEmail(email)) throw new Error('Skriv inn en gyldig e-postadresse.')
  if (!password) throw new Error('Skriv inn passord.')
  const { error } = await client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
  if (error) throw new Error(authErrorMessage(error))
}

export async function signOut(client: AuthClient): Promise<void> {
  const { error } = await client.auth.signOut()
  if (error) throw new Error(authErrorMessage(error))
}

/** Gir alltid samme svar, uansett om e-posten finnes – avslører ikke hvem som har konto. */
export async function requestPasswordReset(client: AuthClient, email: string, origin: string): Promise<void> {
  if (!isValidEmail(email)) throw new Error('Skriv inn en gyldig e-postadresse.')
  const { error } = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: authRedirects(origin).recovery })
  if (error && /rate|too many/i.test(error.message)) throw new Error(authErrorMessage(error))
}

export async function updatePassword(client: AuthClient, password: string, confirm: string): Promise<void> {
  const v = validatePassword(password, confirm)
  if (v) throw new Error(v)
  const { error } = await client.auth.updateUser({ password })
  if (error) throw new Error(authErrorMessage(error))
}

/**
 * Ny innlogging med passord rett før en sensitiv handling (f.eks. sletting av konto).
 * Gir et nytt JWT med ferskt amr-tidspunkt, som serveren krever.
 */
export async function reauthenticate(client: AuthClient, email: string, password: string): Promise<void> {
  if (!password) throw new Error('Skriv inn passordet ditt.')
  const { error } = await client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
  if (error) throw new Error(authErrorMessage(error))
}

export async function resendConfirmation(client: AuthClient, email: string, origin: string): Promise<void> {
  const { error } = await client.auth.resend({ type: 'signup', email: email.trim().toLowerCase(), options: { emailRedirectTo: authRedirects(origin).confirmed } })
  if (error) throw new Error(authErrorMessage(error))
}
