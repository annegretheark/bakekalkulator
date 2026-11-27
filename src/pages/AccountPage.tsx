import { useCallback, useEffect, useState } from 'react'
import { Building2, CloudUpload, CreditCard, Download, KeyRound, LogOut, ShieldCheck, Trash2, User, UserPlus, Users } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { navigate } from '../hooks/useRoute'
import { Card, Notice, PageHeader, SelectField, TextField } from '../components/ui'
import { PLAN_FEATURES, PLAN_NAMES, trialDaysLeft } from '../lib/plans'
import { localRepository } from '../services/storage'
import { dbErrorMessage } from '../services/storage/mappers'
import { getImportRecord, hasImportableData, importLocalData, saveImportRecord, type ImportResult } from '../services/importLocal'
import { formatDate } from '../utils/format'
import type { OrgRole } from '../context/authContext'
import type { Plan } from '../types'
import { reauthenticate, type AuthClient } from '../services/auth'

const ROLE_NAMES: Record<OrgRole, string> = { owner: 'Eier', admin: 'Administrator', member: 'Medlem' }

interface Member { user_id: string; full_name: string | null; email: string | null; role: OrgRole; joined_at: string }

export function AccountPage() {
  const auth = useAuth()
  const { client, user, context, activeOrg, plan, flash, clearFlash } = auth
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  const [name, setName] = useState(context?.profile?.full_name ?? '')

  if (!client || !user) return null
  const ok = (text: string) => setMsg({ tone: 'info', text })
  const fail = (e: unknown) => setMsg({ tone: 'error', text: e instanceof Error ? e.message : dbErrorMessage(e as { message: string }) })

  const saveName = async () => {
    const { error } = await client.from('profiles').update({ full_name: name.trim() }).eq('id', user.id)
    if (error) return fail(new Error(dbErrorMessage(error)))
    await auth.refresh()
    ok('Navnet er oppdatert.')
  }

  const sub = activeOrg?.subscription ?? null
  const daysLeft = trialDaysLeft(sub)

  return (
    <>
      <PageHeader title="Konto" description={user.email ?? ''}
        actions={<button className="btn ghost" onClick={() => auth.signOut().catch(fail)}><LogOut size={16} /> Logg ut</button>} />
      {flash && <Notice>{flash} <button className="link" onClick={clearFlash}>Lukk</button></Notice>}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {auth.contextError && <Notice tone="error">{auth.contextError}</Notice>}

      <ImportPanel />

      <div className="grid-2">
        <div className="stack">
          <Card title="Profil" icon={User}>
            <TextField label="Navn" value={name} onChange={setName} />
            <p className="muted small">E-post: {user.email}{context?.profile?.created_at && ` · registrert ${formatDate(context.profile.created_at)}`}</p>
            <div className="actions">
              <button className="btn primary" disabled={!name.trim() || name.trim() === context?.profile?.full_name} onClick={saveName}>Lagre navn</button>
              <button className="btn ghost" onClick={() => navigate('tilbakestill-passord')}><KeyRound size={16} /> Endre passord</button>
            </div>
          </Card>

          <Card title="Abonnement" icon={CreditCard}>
            {activeOrg && sub ? (
              <>
                <p>
                  <span className="pill">{PLAN_NAMES[plan]}</span>{' '}
                  {sub.status === 'trialing' && daysLeft !== null && daysLeft > 0 && <>Prøveperiode – <strong>{daysLeft} dager igjen</strong> (til {formatDate(sub.trial_ends_at!)})</>}
                  {sub.status === 'trialing' && daysLeft === 0 && <>Prøveperioden er utløpt. Du har nå Free.</>}
                  {sub.status === 'expired' && <>Prøveperioden er utløpt. Du har nå Free.</>}
                  {sub.status === 'active' && <>Aktivt abonnement{sub.current_period_end && ` til ${formatDate(sub.current_period_end)}`}</>}
                </p>
                <PlanTable current={plan} />
                <p className="muted small">Dataene dine slettes ikke når prøveperioden går ut – på Free kan du ikke legge til flere enn grensen tillater. Betaling (Stripe) er ikke aktivert ennå.</p>
              </>
            ) : <p className="muted">Ingen organisasjon funnet.</p>}
          </Card>
        </div>

        <div className="stack">
          <OrganizationPanel onMessage={ok} onError={fail} />

          <Card title="Personvern" icon={ShieldCheck}>
            <p className="muted small">Du kan når som helst laste ned eller slette dataene dine. Les <a href="#/personvern">personvernerklæringen</a> og <a href="#/vilkar">brukervilkårene</a>.</p>
            <LegalStatus onError={fail} onMessage={ok} />
            <ExportButton onError={fail} />
            <DeleteAccount onError={fail} />
          </Card>
        </div>
      </div>
    </>
  )
}

function PlanTable({ current }: { current: Plan }) {
  const lim = (n: number | null) => (n === null ? 'Ubegrenset' : String(n))
  return (
    <div className="table-wrap">
      <table className="clean">
        <thead><tr><th /> {(['free', 'plus', 'pro'] as Plan[]).map((p) => <th key={p} className={`num ${p === current ? 'current-plan' : ''}`}>{PLAN_NAMES[p]}</th>)}</tr></thead>
        <tbody>
          <tr><td>Oppskrifter</td>{(['free', 'plus', 'pro'] as Plan[]).map((p) => <td key={p} className="num">{lim(PLAN_FEATURES[p].maxRecipes)}</td>)}</tr>
          <tr><td>Ingredienser</td>{(['free', 'plus', 'pro'] as Plan[]).map((p) => <td key={p} className="num">{lim(PLAN_FEATURES[p].maxIngredients)}</td>)}</tr>
          <tr><td>Brukere (bedrift)</td>{(['free', 'plus', 'pro'] as Plan[]).map((p) => <td key={p} className="num">{PLAN_FEATURES[p].maxMembers}</td>)}</tr>
          <tr><td>Salg og fortjeneste</td>{(['free', 'plus', 'pro'] as Plan[]).map((p) => <td key={p} className="num">{PLAN_FEATURES[p].salesCalculator ? 'Ja' : '–'}</td>)}</tr>
          <tr><td>Skanning av oppskrifter og kvitteringer</td>{(['free', 'plus', 'pro'] as Plan[]).map((p) => <td key={p} className="num">{PLAN_FEATURES[p].scanning ? 'Ja' : '–'}</td>)}</tr>
        </tbody>
      </table>
    </div>
  )
}

function ImportPanel() {
  const { client, activeOrg } = useAuth()
  const [local] = useState(() => localRepository.peek())
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cleared, setCleared] = useState(false)
  if (!client || !activeOrg || cleared || !hasImportableData(local)) return null
  const previous = getImportRecord(activeOrg.id)

  const run = async () => {
    setBusy(true); setError(null)
    try {
      const r = await importLocalData(client, activeOrg.id, local!)
      saveImportRecord(activeOrg.id, r)
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Importen feilet.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Importer lokale data" icon={CloudUpload}>
      <p>Denne nettleseren har <strong>{local!.recipes.length} oppskrifter</strong> og <strong>{local!.ingredients.length} ingredienser</strong> lagret lokalt. Vil du kopiere dem til {activeOrg.name}?</p>
      <p className="muted small">Det som allerede er importert hoppes over, så du får ikke duplikater. Bakehistorikk importeres ikke. Lokale data slettes ikke automatisk.</p>
      {previous && !result && <Notice>Sist importert {formatDate(previous.at)}. Ny import legger bare til det som mangler.</Notice>}
      {error && <Notice tone="error">{error} Ingenting ble lagret, og de lokale dataene er urørt.</Notice>}
      {result ? (
        <>
          <Notice>
            Importen er fullført: {result.recipes_inserted} nye oppskrifter og {result.ingredients_inserted} nye ingredienser
            {(result.recipes_skipped + result.ingredients_skipped) > 0 && ` (${result.recipes_skipped + result.ingredients_skipped} fantes fra før)`}.
            Last siden på nytt for å se dem.
          </Notice>
          <div className="actions">
            <button className="btn primary" onClick={() => window.location.reload()}>Last inn på nytt</button>
            <button className="btn ghost" onClick={() => { if (confirm('Slette de lokale dataene i denne nettleseren? Dataene i kontoen beholdes.')) { localRepository.clear(); setCleared(true) } }}>
              <Trash2 size={16} /> Slett lokale data
            </button>
          </div>
        </>
      ) : (
        <div className="actions"><button className="btn primary" disabled={busy} onClick={run}><CloudUpload size={16} /> {busy ? 'Importerer …' : 'Importer'}</button></div>
      )}
    </Card>
  )
}

function OrganizationPanel({ onMessage, onError }: { onMessage: (t: string) => void; onError: (e: unknown) => void }) {
  const auth = useAuth()
  const { client, context, activeOrg, user } = auth
  const [members, setMembers] = useState<Member[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrgRole>('member')
  const [orgName, setOrgName] = useState(activeOrg?.name ?? '')

  const fetchMembers = useCallback(async (): Promise<Member[]> => {
    if (!client || !activeOrg || activeOrg.type !== 'business') return []
    const { data, error } = await client.rpc('list_organization_members', { org: activeOrg.id })
    if (error) throw new Error(dbErrorMessage(error))
    return data as Member[]
  }, [client, activeOrg])
  const loadMembers = useCallback(async () => setMembers(await fetchMembers()), [fetchMembers])

  const [membersError, setMembersError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fetchMembers()
      .then((m) => { if (alive) setMembers(m) })
      .catch((e: unknown) => { if (alive) setMembersError(e instanceof Error ? e.message : 'Kunne ikke hente medlemmer.') })
    return () => { alive = false }
  }, [fetchMembers])

  if (!client || !activeOrg || !user) return null
  const canManage = activeOrg.role === 'owner' || activeOrg.role === 'admin'
  const isOwner = activeOrg.role === 'owner'
  const rpc = async (fn: string, args: Record<string, unknown>, success: string) => {
    const { error } = await client.rpc(fn, args)
    if (error) return onError(new Error(dbErrorMessage(error)))
    await Promise.all([loadMembers(), auth.refresh()])
    onMessage(success)
  }

  return (
    <Card title="Organisasjon" icon={activeOrg.type === 'business' ? Building2 : User}>
      {(context?.organizations.length ?? 0) > 1 && (
        <SelectField label="Aktiv organisasjon" value={activeOrg.id} onChange={(id) => auth.setActiveOrg(id).catch(onError)}
          options={context!.organizations.map((o) => ({ value: o.id, label: `${o.name} (${ROLE_NAMES[o.role]})` }))} />
      )}
      <p>
        <strong>{activeOrg.name}</strong> · {activeOrg.type === 'business' ? 'Bedrift' : 'Privat'} · din rolle: {ROLE_NAMES[activeOrg.role]}
      </p>

      {activeOrg.type === 'business' && canManage && (
        <div className="inline-form">
          <TextField label="Firmanavn" value={orgName} onChange={setOrgName} />
          <button className="btn ghost" disabled={!orgName.trim() || orgName === activeOrg.name} onClick={async () => {
            const { error } = await client.from('organizations').update({ name: orgName.trim() }).eq('id', activeOrg.id)
            if (error) return onError(new Error(dbErrorMessage(error)))
            await auth.refresh(); onMessage('Firmanavnet er oppdatert.')
          }}>Lagre</button>
        </div>
      )}

      {activeOrg.type === 'business' && (
        <>
          <h3 className="sub-head"><Users size={16} /> Medlemmer</h3>
          {membersError && <Notice tone="error">{membersError}</Notice>}
          <ul className="member-list">
            {members.map((m) => (
              <li key={m.user_id}>
                <span><strong>{m.full_name ?? 'Ukjent'}</strong>{m.user_id === user.id && ' (deg)'}<small className="muted block">{m.email}</small></span>
                <span className="member-actions">
                  {isOwner && m.user_id !== user.id ? (
                    <select aria-label={`Rolle for ${m.full_name}`} value={m.role} onChange={(e) => rpc('set_member_role', { org: activeOrg.id, member_id: m.user_id, new_role: e.target.value }, 'Rollen er endret.')}>
                      {(['owner', 'admin', 'member'] as OrgRole[]).map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
                    </select>
                  ) : <span className="pill">{ROLE_NAMES[m.role]}</span>}
                  {canManage && m.user_id !== user.id && (isOwner || m.role === 'member') && (
                    <button className="icon-btn danger" aria-label={`Fjern ${m.full_name}`} onClick={() => confirm(`Fjerne ${m.full_name ?? m.email} fra ${activeOrg.name}?`) && rpc('remove_member', { org: activeOrg.id, member_id: m.user_id }, 'Medlemmet er fjernet.')}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {canManage && (
            <div className="inline-form">
              <TextField label="Legg til bruker (e-post)" type="email" value={email} onChange={setEmail} />
              <SelectField<OrgRole> label="Rolle" value={role} onChange={setRole}
                options={(isOwner ? ['member', 'admin', 'owner'] as OrgRole[] : ['member', 'admin'] as OrgRole[]).map((r) => ({ value: r, label: ROLE_NAMES[r] }))} />
              <button className="btn ghost" disabled={!email.trim()} onClick={async () => { await rpc('add_member_by_email', { org: activeOrg.id, member_email: email, member_role: role }, 'Brukeren er lagt til.'); setEmail('') }}>
                <UserPlus size={16} /> Legg til
              </button>
            </div>
          )}
          {canManage && <p className="muted small">Brukeren må ha registrert seg først. Antall brukere avhenger av abonnementet ({activeOrg.features?.max_members ?? 1} på nåværende plan).</p>}
          {(context?.organizations.length ?? 0) > 1 && (
            <button className="link" onClick={() => confirm(`Forlate ${activeOrg.name}? Du mister tilgangen til organisasjonens data.`) && rpc('leave_organization', { org: activeOrg.id }, 'Du har forlatt organisasjonen.')}>Forlat organisasjonen</button>
          )}
        </>
      )}
    </Card>
  )
}

function LegalStatus({ onError, onMessage }: { onError: (e: unknown) => void; onMessage: (t: string) => void }) {
  const auth = useAuth()
  const legal = auth.context?.legal
  if (!auth.client || !legal) return null
  const names = { terms: 'Brukervilkår', privacy: 'Personvernerklæring' } as const
  return (
    <ul className="small legal-list">
      {legal.current.map((d) => {
        const accepted = legal.accepted.find((a) => a.document === d.document && a.version === d.version)
        return (
          <li key={d.document}>
            <strong>{names[d.document]}</strong> (versjon {d.version}):{' '}
            {accepted ? <>godkjent {formatDate(accepted.accepted_at)}</> : (
              <button className="link" onClick={async () => {
                const { error } = await auth.client!.rpc('accept_legal_document', { doc: d.document, doc_version: d.version })
                if (error) return onError(new Error(dbErrorMessage(error)))
                await auth.refresh(); onMessage(`${names[d.document]} er godkjent.`)
              }}>Ikke godkjent – godkjenn nå</button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function ExportButton({ onError }: { onError: (e: unknown) => void }) {
  const { client } = useAuth()
  const [busy, setBusy] = useState(false)
  if (!client) return null
  return (
    <button className="btn ghost" disabled={busy} onClick={async () => {
      setBusy(true)
      try {
        const { data, error } = await client.rpc('export_my_data')
        if (error) throw new Error(dbErrorMessage(error))
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `mine-data-bakekalkulator-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(a.href)
      } catch (e) { onError(e) } finally { setBusy(false) }
    }}><Download size={16} /> {busy ? 'Henter …' : 'Last ned mine data'}</button>
  )
}

function DeleteAccount({ onError }: { onError: (e: unknown) => void }) {
  const { client, context, user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  if (!client || !user) return null
  const shared = (context?.organizations ?? []).filter((o) => o.member_count > 1)

  if (!open) return <button className="btn danger" onClick={() => setOpen(true)}><Trash2 size={16} /> Slett kontoen min</button>
  return (
    <div className="danger-zone">
      <p><strong>Slett kontoen permanent.</strong> Dette kan ikke angres.</p>
      <ul className="small">
        <li>Profil, innstillinger og innlogging slettes.</li>
        <li>Organisasjoner der du er eneste medlem slettes med alle oppskrifter, ingredienser og historikk.</li>
        {shared.length > 0 && <li>Du fjernes fra {shared.map((o) => o.name).join(', ')}. Dataene der beholdes, og eierskapet overføres til en annen bruker om nødvendig.</li>}
      </ul>
      <TextField label="Passord (ny innlogging kreves)" type="password" value={password} onChange={setPassword} />
      <TextField label="Skriv SLETT for å bekrefte" value={text} onChange={setText} />
      <div className="actions">
        <button className="btn danger" disabled={text !== 'SLETT' || !password || busy} onClick={async () => {
          setBusy(true)
          try {
            // Serveren krever nylig innlogging (amr i JWT) i tillegg til «SLETT»
            await reauthenticate(client as unknown as AuthClient, user.email ?? '', password)
            const { error } = await client.rpc('delete_my_account', { confirmation: text })
            if (error) throw new Error(dbErrorMessage(error))
            await signOut().catch(() => {})
            alert('Kontoen er slettet.')
          } catch (e) { onError(e) } finally { setBusy(false) }
        }}>{busy ? 'Sletter …' : 'Slett kontoen permanent'}</button>
        <button className="btn ghost" onClick={() => { setOpen(false); setText('') }}>Avbryt</button>
      </div>
    </div>
  )
}
