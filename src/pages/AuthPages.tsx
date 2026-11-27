import { useState, type FormEvent } from 'react'
import { Building2, KeyRound, LogIn, Mail, User, UserPlus } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { navigate } from '../hooks/useRoute'
import { readLastEmail, rememberEmail } from '../lib/lastEmail'
import { Card, Notice, PageHeader, SelectField, TextField } from '../components/ui'
import { BUSINESS_TYPE_NAMES } from '../lib/businessTypes'
import { BUSINESS_TYPES, type BusinessType } from '../types'
import {
  MIN_PASSWORD_LENGTH, requestPasswordReset, resendConfirmation, signIn, signUp, updatePassword, validateRegistration,
  type AuthClient, type RegistrationInput,
} from '../services/auth'

function NotConfigured() {
  return (
    <Notice tone="warn">
      Innlogging er ikke satt opp i denne installasjonen. Kalkulatoren fungerer som før med lokal lagring i nettleseren.
    </Notice>
  )
}

function useSubmit() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Noe gikk galt.') } finally { setBusy(false) }
  }
  return { busy, error, run, setError }
}

export function LoginPage() {
  const { client, user } = useAuth()
  const [email, setEmail] = useState(readLastEmail)
  const [password, setPassword] = useState('')
  const [unconfirmed, setUnconfirmed] = useState(false)
  const [resent, setResent] = useState(false)
  const { busy, error, run } = useSubmit()

  if (!client) return <><PageHeader title="Logg inn" /><NotConfigured /></>
  if (user) return <><PageHeader title="Logg inn" /><Notice>Du er allerede innlogget. <button className="link" onClick={() => navigate('konto')}>Gå til konto</button></Notice></>

  const submit = (e: FormEvent) => {
    e.preventDefault()
    run(async () => {
      try {
        await signIn(client as unknown as AuthClient, email, password)
        rememberEmail(email)
        // Fra innloggingssiden: gå til oversikten. Ellers blir brukeren på siden de prøvde å åpne.
        if (/^#\/?logg-inn$/.test(window.location.hash)) navigate('oversikt')
      } catch (err) {
        setUnconfirmed(err instanceof Error && err.message.includes('ikke bekreftet'))
        throw err
      }
    })
  }

  return (
    <>
      <PageHeader title="Logg inn" description="Logg inn for å bruke Matkalkulatoren. Ny bruker? Opprett en konto og få 30 dager gratis Pro." />
      <Card className="auth-card">
        <form onSubmit={submit} className="stack" noValidate>
          <TextField label="E-post" type="email" value={email} onChange={setEmail} />
          <TextField label="Passord" type="password" value={password} onChange={setPassword} />
          {error && <Notice tone="error">{error}</Notice>}
          {unconfirmed && (
            <button type="button" className="link" disabled={resent} onClick={() => run(async () => { await resendConfirmation(client as unknown as AuthClient, email, window.location.origin); setResent(true) })}>
              {resent ? 'Ny bekreftelseslenke er sendt' : 'Send bekreftelseslenken på nytt'}
            </button>
          )}
          <button className="btn primary" type="submit" disabled={busy}><LogIn size={18} /> {busy ? 'Logger inn …' : 'Logg inn'}</button>
          <div className="auth-links">
            <button type="button" className="link" onClick={() => navigate('glemt-passord')}>Glemt passord?</button>
            <button type="button" className="link" onClick={() => navigate('registrer')}>Opprett konto</button>
          </div>
        </form>
      </Card>
    </>
  )
}

export function RegisterPage() {
  const { client, user } = useAuth()
  const [form, setForm] = useState<RegistrationInput>({ fullName: '', email: '', password: '', passwordConfirm: '', accountType: 'private', businessType: 'privat', organizationName: '', acceptTerms: false, acceptPrivacy: false })
  const [done, setDone] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const { busy, error, run } = useSubmit()
  const set = <K extends keyof RegistrationInput>(k: K, v: RegistrationInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const errors = touched ? validateRegistration(form) : {}

  if (!client) return <><PageHeader title="Opprett konto" /><NotConfigured /></>
  if (user) return <><PageHeader title="Opprett konto" /><Notice>Du er allerede innlogget.</Notice></>
  if (done) {
    return (
      <>
        <PageHeader title="Sjekk e-posten din" />
        <Card className="auth-card">
          <Mail size={32} aria-hidden className="accent" />
          <p>Vi har sendt en bekreftelseslenke til <strong>{done}</strong>. Klikk på lenken for å aktivere kontoen.</p>
          <p className="muted small">Du får 30 dagers gratis prøveperiode med Pro – uten betalingskort.</p>
          <button className="btn ghost" onClick={() => navigate('logg-inn')}>Til innlogging</button>
        </Card>
      </>
    )
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (Object.keys(validateRegistration(form)).length) return
    run(async () => {
      const r = await signUp(client as unknown as AuthClient, form, window.location.origin)
      if (r.needsConfirmation) setDone(form.email.trim())
      else navigate('konto')
    })
  }

  return (
    <>
      <PageHeader title="Opprett konto" description="30 dagers gratis prøveperiode med Pro. Ingen betalingskort." />
      <Card className="auth-card">
        <form onSubmit={submit} className="stack" noValidate>
          <div className="field">
            <SelectField<BusinessType> label="Virksomhetstype" value={form.businessType ?? 'privat'}
              onChange={(v) => setForm((f) => ({ ...f, businessType: v, accountType: v === 'privat' ? 'private' : 'business' }))}
              options={BUSINESS_TYPES.map((b) => ({ value: b, label: BUSINESS_TYPE_NAMES[b] }))} />
            <small className="muted">{form.accountType === 'business' ? 'Bedrifter kan invitere flere brukere og får priser eks. mva. Meny og ord tilpasses virksomheten.' : 'For hjemmebruk.'}</small>
          </div>
          <TextField label="Fullt navn" value={form.fullName} onChange={(v) => set('fullName', v)} />
          {errors.fullName && <small className="error">{errors.fullName}</small>}
          {form.accountType === 'business' && (
            <>
              <TextField label="Firmanavn" value={form.organizationName} onChange={(v) => set('organizationName', v)} />
              {errors.organizationName && <small className="error">{errors.organizationName}</small>}
            </>
          )}
          <TextField label="E-post" type="email" value={form.email} onChange={(v) => set('email', v)} />
          {errors.email && <small className="error">{errors.email}</small>}
          <TextField label={`Passord (minst ${MIN_PASSWORD_LENGTH} tegn, bokstaver og tall)`} type="password" value={form.password} onChange={(v) => set('password', v)} />
          <TextField label="Gjenta passord" type="password" value={form.passwordConfirm} onChange={(v) => set('passwordConfirm', v)} />
          {errors.password && <small className="error">{errors.password}</small>}
          <label className="check">
            <input type="checkbox" checked={form.acceptTerms} onChange={(e) => set('acceptTerms', e.target.checked)} />
            <span>Jeg godtar <a href="#/vilkar" target="_blank">brukervilkårene</a>.</span>
          </label>
          {errors.acceptTerms && <small className="error">{errors.acceptTerms}</small>}
          <label className="check">
            <input type="checkbox" checked={form.acceptPrivacy} onChange={(e) => set('acceptPrivacy', e.target.checked)} />
            <span>Jeg har lest <a href="#/personvern" target="_blank">personvernerklæringen</a>.</span>
          </label>
          {errors.acceptPrivacy && <small className="error">{errors.acceptPrivacy}</small>}
          {error && <Notice tone="error">{error}</Notice>}
          <button className="btn primary" type="submit" disabled={busy}>
            {form.accountType === 'business' ? <Building2 size={18} /> : <UserPlus size={18} />} {busy ? 'Oppretter …' : 'Opprett konto'}
          </button>
          <div className="auth-links">
            <span className="muted small">Har du konto?</span>
            <button type="button" className="link" onClick={() => navigate('logg-inn')}>Logg inn</button>
          </div>
        </form>
      </Card>
    </>
  )
}

export function ForgotPasswordPage() {
  const { client } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const { busy, error, run } = useSubmit()
  if (!client) return <><PageHeader title="Glemt passord" /><NotConfigured /></>

  return (
    <>
      <PageHeader title="Glemt passord" description="Vi sender deg en lenke for å velge nytt passord." />
      <Card className="auth-card">
        {sent ? (
          <Notice>Hvis det finnes en konto for <strong>{email}</strong>, har vi sendt en lenke for tilbakestilling. Sjekk innboksen (og søppelpost).</Notice>
        ) : (
          <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); run(async () => { await requestPasswordReset(client as unknown as AuthClient, email, window.location.origin); setSent(true) }) }}>
            <TextField label="E-post" type="email" value={email} onChange={setEmail} />
            {error && <Notice tone="error">{error}</Notice>}
            <button className="btn primary" type="submit" disabled={busy}><Mail size={18} /> {busy ? 'Sender …' : 'Send lenke'}</button>
          </form>
        )}
        <button className="link" onClick={() => navigate('logg-inn')}>Tilbake til innlogging</button>
      </Card>
    </>
  )
}

export function ResetPasswordPage() {
  const { client, user, recovery, clearRecovery } = useAuth()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [done, setDone] = useState(false)
  const { busy, error, run } = useSubmit()
  if (!client) return <><PageHeader title="Nytt passord" /><NotConfigured /></>

  if (!user) {
    return (
      <>
        <PageHeader title="Nytt passord" />
        <Notice tone="warn">Lenken er ugyldig eller utløpt. <button className="link" onClick={() => navigate('glemt-passord')}>Be om en ny lenke</button>.</Notice>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Nytt passord" description={recovery ? 'Velg et nytt passord for kontoen din.' : 'Endre passordet for kontoen din.'} />
      <Card className="auth-card">
        {done ? (
          <>
            <Notice>Passordet er oppdatert.</Notice>
            <button className="btn primary" onClick={() => navigate('oversikt')}>Fortsett</button>
          </>
        ) : (
          <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); run(async () => { await updatePassword(client as unknown as AuthClient, pw, pw2); clearRecovery(); setDone(true) }) }}>
            <p className="muted small"><User size={14} /> {user.email}</p>
            <TextField label="Nytt passord" type="password" value={pw} onChange={setPw} />
            <TextField label="Gjenta nytt passord" type="password" value={pw2} onChange={setPw2} />
            {error && <Notice tone="error">{error}</Notice>}
            <button className="btn primary" type="submit" disabled={busy}><KeyRound size={18} /> {busy ? 'Lagrer …' : 'Lagre passord'}</button>
          </form>
        )}
      </Card>
    </>
  )
}
