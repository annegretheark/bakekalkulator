import { useCallback, useEffect, useState } from 'react'
import { Building2, CalendarClock, Clock, Landmark, Plus, RefreshCw, Save, Shield, Trash2, Users } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { Card, Notice, NumberField, PageHeader, SelectField, StatCard, TextField } from '../components/ui'
import { dbErrorMessage, tariffFromRow, tariffToRpc, type TariffRow } from '../services/storage/mappers'
import { isTariffActive } from '../utils/tariffs'
import { osloDateKey } from '../services/priceApi'
import { PLAN_NAMES } from '../lib/plans'
import { formatDate } from '../utils/format'
import type { Plan, Tariff } from '../types'

interface Overview {
  customers: number; private_customers: number; business_customers: number; users: number
  active_trials: number; expired_trials: number; paid_active: number; effective_plans: Record<string, number>
}
interface SubRow {
  organization_id: string; organization_name: string; organization_type: 'private' | 'business'; member_count: number
  plan: Plan; status: string; effective_plan: Plan; trial_ends_at: string | null; current_period_end: string | null; created_at: string
}

const STATUS_NAMES: Record<string, string> = { trialing: 'Prøve', active: 'Aktiv', past_due: 'Forfalt', canceled: 'Avsluttet', expired: 'Utløpt' }

const blankTariff = (): Tariff => ({
  code: '', description: '', value: 0, unit: 'kr/kWh eks. mva', area: null, customerType: null,
  validFrom: osloDateKey(new Date()), validTo: null, sourceUrl: 'https://', verifiedAt: null, notes: '', // verifisert-dato settes først når kilden faktisk er kontrollert
})

/**
 * Administrasjon for systemeier. Alle data hentes via SECURITY DEFINER-funksjoner
 * som sjekker is_system_admin() på serveren og bare returnerer aggregater og
 * abonnementsinformasjon – aldri kundenes oppskrifter eller andre private data.
 */
export function AdminPage() {
  const { client, isAdmin } = useAuth()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [subs, setSubs] = useState<SubRow[]>([])
  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [editing, setEditing] = useState<Tariff | null>(null)
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)

  /** Henter oversikt, abonnementer og satser (ren funksjon – setter ikke state). */
  const fetchAll = useCallback(async () => {
    if (!client) return null
    const [o, s, t] = await Promise.all([
      client.rpc('admin_overview'),
      client.rpc('admin_list_subscriptions', { max_rows: 500, skip_rows: 0 }),
      client.from('electricity_tariffs').select('*').order('code').order('valid_from', { ascending: false }),
    ])
    const err = o.error ?? s.error ?? t.error
    if (err) throw new Error(dbErrorMessage(err))
    return { overview: o.data as Overview, subs: s.data as SubRow[], tariffs: (t.data as TariffRow[]).map(tariffFromRow) }
  }, [client])

  const apply = (r: Awaited<ReturnType<typeof fetchAll>>) => {
    if (!r) return
    setOverview(r.overview)
    setSubs(r.subs)
    setTariffs(r.tariffs)
  }
  const load = async () => apply(await fetchAll())

  useEffect(() => {
    if (!isAdmin) return
    let alive = true
    fetchAll()
      .then((r) => { if (alive && r) { setOverview(r.overview); setSubs(r.subs); setTariffs(r.tariffs) } })
      .catch((e: unknown) => { if (alive) setMsg({ tone: 'error', text: e instanceof Error ? e.message : 'Feil' }) })
    return () => { alive = false }
  }, [isAdmin, fetchAll])

  if (!client || !isAdmin) {
    return <><PageHeader title="Administrasjon" /><Notice tone="error">Du har ikke tilgang til denne siden.</Notice></>
  }

  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>, text: string) => {
    const { error } = await fn()
    if (error) return setMsg({ tone: 'error', text: dbErrorMessage(error) })
    setMsg({ tone: 'info', text })
    await load()
  }

  const today = osloDateKey(new Date())

  return (
    <>
      <PageHeader title="Administrasjon" description="Systemeier: kunder, abonnementer og offentlige strømprissatser. Ingen tilgang til kundenes oppskrifter eller andre private data."
        actions={<button className="btn ghost" onClick={() => load().catch(() => {})}><RefreshCw size={16} /> Oppdater</button>} />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {overview && (
        <div className="stats-grid">
          <StatCard icon={Building2} label="Registrerte kunder" value={String(overview.customers)} sub={`${overview.private_customers} privat · ${overview.business_customers} bedrift`} />
          <StatCard icon={Users} label="Brukere" value={String(overview.users)} />
          <StatCard icon={Clock} label="Aktive prøveperioder" value={String(overview.active_trials)} tone="green" />
          <StatCard icon={CalendarClock} label="Utløpte prøveperioder" value={String(overview.expired_trials)} tone="amber" />
          <StatCard icon={Shield} label="Betalende" value={String(overview.paid_active)}
            sub={Object.entries(overview.effective_plans).map(([p, n]) => `${PLAN_NAMES[p as Plan] ?? p}: ${n}`).join(' · ')} />
        </div>
      )}

      <Card title="Abonnementer" icon={Shield}>
        <div className="table-wrap">
          <table className="clean responsive">
            <thead><tr><th>Kunde</th><th>Type</th><th className="num">Brukere</th><th>Status</th><th>Effektiv plan</th><th>Prøve til</th><th>Endre</th></tr></thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.organization_id}>
                  <td data-label="Kunde"><strong>{s.organization_name}</strong><small className="muted block">Opprettet {formatDate(s.created_at)}</small></td>
                  <td data-label="Type">{s.organization_type === 'business' ? 'Bedrift' : 'Privat'}</td>
                  <td data-label="Brukere" className="num">{s.member_count}</td>
                  <td data-label="Status">{PLAN_NAMES[s.plan]} · {STATUS_NAMES[s.status] ?? s.status}</td>
                  <td data-label="Effektiv plan"><span className="pill">{PLAN_NAMES[s.effective_plan]}</span></td>
                  <td data-label="Prøve til">{s.trial_ends_at ? formatDate(s.trial_ends_at) : '–'}</td>
                  <td data-label="Endre">
                    <select aria-label={`Endre abonnement for ${s.organization_name}`} value="" onChange={(e) => {
                      const [plan, status] = e.target.value.split(':')
                      if (plan && confirm(`Sette ${s.organization_name} til ${PLAN_NAMES[plan as Plan]} (${STATUS_NAMES[status]})?`)) {
                        act(() => client.rpc('admin_set_subscription', { org: s.organization_id, new_plan: plan, new_status: status, period_end: null }), 'Abonnementet er oppdatert.')
                      }
                    }}>
                      <option value="">Velg …</option>
                      <option value="free:active">Free</option>
                      <option value="plus:active">Plus (aktiv)</option>
                      <option value="pro:active">Pro (aktiv)</option>
                      <option value="free:expired">Avslutt prøve</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Manuell endring frem til Stripe er på plass. Kundene kan ikke endre abonnement selv.</p>
      </Card>

      <Card title="Strømprissatser" icon={Landmark} actions={<button className="btn ghost" onClick={() => setEditing(blankTariff())}><Plus size={16} /> Ny sats</button>}>
        <p className="muted small">Satser med gyldighetsperiode. Appen bruker kun satser som gjelder på beregningsdatoen. Koder i bruk: norgespris, stromstotte_terskel, stromstotte_dekning, elavgift.</p>
        {editing && (
          <div className="component-editor">
            <div className="form-grid">
              <TextField label="Kode" value={editing.code} onChange={(v) => setEditing({ ...editing, code: v.toLowerCase() })} />
              <TextField label="Beskrivelse" value={editing.description} onChange={(v) => setEditing({ ...editing, description: v })} />
              <NumberField label="Verdi" value={editing.value} min={-1000} onChange={(v) => setEditing({ ...editing, value: v })} />
              <TextField label="Enhet" value={editing.unit} onChange={(v) => setEditing({ ...editing, unit: v })} />
              <SelectField label="Kundetype" value={editing.customerType ?? ''} onChange={(v) => setEditing({ ...editing, customerType: (v || null) as Tariff['customerType'] })}
                options={[{ value: '', label: 'Alle' }, { value: 'privat', label: 'Privat' }, { value: 'bedrift', label: 'Bedrift' }]} />
              <SelectField label="Prisområde" value={editing.area ?? ''} onChange={(v) => setEditing({ ...editing, area: (v || null) as Tariff['area'] })}
                options={[{ value: '', label: 'Alle' }, ...['NO1', 'NO2', 'NO3', 'NO4', 'NO5'].map((a) => ({ value: a, label: a }))]} />
              <TextField label="Gyldig fra" type="date" value={editing.validFrom} onChange={(v) => setEditing({ ...editing, validFrom: v })} />
              <TextField label="Gyldig til (tom = inntil videre)" type="date" value={editing.validTo ?? ''} onChange={(v) => setEditing({ ...editing, validTo: v || null })} />
              <TextField label="Kilde (https)" value={editing.sourceUrl} onChange={(v) => setEditing({ ...editing, sourceUrl: v })} />
              <TextField label="Kilde kontrollert (tom = ikke kontrollert, brukes ikke automatisk)" type="date" value={editing.verifiedAt ?? ''} onChange={(v) => setEditing({ ...editing, verifiedAt: v || null })} />
              <TextField label="Merknad" value={editing.notes ?? ''} onChange={(v) => setEditing({ ...editing, notes: v })} />
            </div>
            <div className="actions">
              <button className="btn primary" disabled={!editing.code || !editing.description || !editing.sourceUrl.startsWith('https://')}
                onClick={() => act(() => client.rpc('admin_upsert_tariff', { tariff: tariffToRpc(editing) }), 'Satsen er lagret.').then(() => setEditing(null))}>
                <Save size={16} /> Lagre sats
              </button>
              <button className="btn ghost" onClick={() => setEditing(null)}>Avbryt</button>
            </div>
          </div>
        )}
        <div className="table-wrap">
          <table className="clean responsive">
            <thead><tr><th>Kode</th><th className="num">Verdi</th><th>Gyldig</th><th>Verifisert</th><th>Status</th><th /></tr></thead>
            <tbody>
              {tariffs.map((tr) => (
                <tr key={tr.id} className={isTariffActive(tr, today) ? '' : 'excluded'}>
                  <td data-label="Kode"><strong>{tr.code}</strong><small className="muted block">{tr.description}{tr.customerType ? ` · ${tr.customerType}` : ''}{tr.area ? ` · ${tr.area}` : ''}</small></td>
                  <td data-label="Verdi" className="num">{tr.value} {tr.unit}</td>
                  <td data-label="Gyldig">{tr.validFrom} – {tr.validTo ?? 'inntil videre'}</td>
                  <td data-label="Verifisert">{tr.verifiedAt ?? <strong className="neg">Ikke kontrollert</strong>}</td>
                  <td data-label="Status">{isTariffActive(tr, today) ? 'Gjeldende' : tr.validTo && tr.validTo < today ? 'Utløpt' : 'Fremtidig'}</td>
                  <td className="row-actions">
                    <button className="icon-btn" aria-label="Rediger" onClick={() => setEditing(tr)}><Save size={16} /></button>
                    <button className="icon-btn danger" aria-label="Slett" onClick={() => confirm(`Slette satsen ${tr.code} (${tr.validFrom})?`) && act(() => client.rpc('admin_delete_tariff', { tariff_id: tr.id }), 'Satsen er slettet.')}><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
