import { useState } from 'react'
import { Building, Plus, Save, Trash2, Users } from 'lucide-react'
import type { CostSettings, OperatingCost, StaffRole } from '../types'
import { useData, useFormat } from '../hooks/useData'
import { useAuth } from '../hooks/useAuth'
import { useReferencePrice } from '../hooks/useRecipeCosts'
import { Card, Notice, NumberField, PageHeader, Segmented, TextField, Toggle } from '../components/ui'
import { defaultStaffRole } from '../lib/defaults'
import { formatKwh, formatMoney, uid } from '../utils/format'
import { hourlyCost, overhead } from '../utils/staffCosts'

const OPERATING_SUGGESTIONS = ['Husleie', 'Forsikring', 'Regnskap', 'Kortterminal og kassesystem', 'Renhold', 'Avfall', 'Vedlikehold']

/** Personalkostnader (roller med timekostnad) og faste driftskostnader per måned. */
export function CostsPage() {
  const f = useFormat()
  const { data, saveCostSettings } = useData()
  const auth = useAuth()
  const readOnly = !!auth.user && !!auth.activeOrg && auth.activeOrg.role === 'member'
  const { price, source } = useReferencePrice()
  const [draft, setDraft] = useState<CostSettings>(data.costs)
  const [saved, setSaved] = useState(false)
  // Nye data fra lagringen (f.eks. etter lagring eller feil) erstatter utkastet
  const [base, setBase] = useState(data.costs)
  if (base !== data.costs) { setBase(data.costs); setDraft(data.costs) }

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.costs)
  const set = (p: Partial<CostSettings>) => { setDraft({ ...draft, ...p }); setSaved(false) }
  const setRole = (id: string, p: Partial<StaffRole>) => set({ staffRoles: draft.staffRoles.map((r) => (r.id === id ? { ...r, ...p } : r)) })
  const setCost = (id: string, p: Partial<OperatingCost>) => set({ operatingCosts: draft.operatingCosts.map((c) => (c.id === id ? { ...c, ...p } : c)) })
  const usedRoles = new Set(data.recipes.flatMap((r) => r.labor.map((l) => l.roleId)))
  const valid = draft.staffRoles.every((r) => r.name.trim()) && draft.operatingCosts.every((c) => c.name.trim())

  const save = async () => {
    await saveCostSettings({
      ...draft,
      staffRoles: draft.staffRoles.map((r) => ({ ...r, name: r.name.trim() })),
      operatingCosts: draft.operatingCosts.map((c) => ({ ...c, name: c.name.trim() })),
    })
    setSaved(true)
  }

  const oh = overhead(draft, data.equipment, price)

  return (
    <>
      <PageHeader title="Personal og drift" description="Timekostnader for de ansatte og faste kostnader per måned. Brukes i oppskrifter og menyer."
        actions={!readOnly && <button className="btn primary" disabled={!dirty || !valid} onClick={save}><Save size={18} /> Lagre</button>} />
      {readOnly && <Notice>Bare eier eller administrator kan endre personal- og driftskostnader.</Notice>}
      {saved && !dirty && <Notice>Lagret. Oppskrifter og menyer bruker de nye satsene.</Notice>}

      <Card title="Personalkostnader" icon={Users}>
        <p className="muted small">
          Legg inn én rad per rolle eller ansattgruppe. Velg «Detaljert» for å regne ut timekostnaden fra timelønn, eller «Ferdig timekostnad» hvis du allerede kjenner den.
          Arbeidstiden registreres i hver oppskrift og fordeles på antall stk eller porsjoner.
        </p>
        {draft.staffRoles.map((r) => {
          const h = hourlyCost(r)
          return (
            <fieldset key={r.id} className="cost-role" disabled={readOnly}>
              <div className="form-grid">
                <TextField label="Rolle" required value={r.name} onChange={(v) => setRole(r.id, { name: v })} placeholder="F.eks. Kokk, servitør, baker" />
                <div className="field">
                  <span className="label">Beregning</span>
                  <Segmented<StaffRole['mode']> label="Beregning" value={r.mode} onChange={(v) => setRole(r.id, { mode: v })} disabled={readOnly}
                    options={[{ value: 'detaljert', label: 'Detaljert' }, { value: 'ferdig', label: 'Ferdig timekostnad' }]} />
                </div>
                {r.mode === 'ferdig' ? (
                  <NumberField label="Timekostnad" value={r.fixedHourlyCost} max={100000} onChange={(v) => setRole(r.id, { fixedHourlyCost: v })} suffix="kr/t" hint="Alt inkludert" />
                ) : (
                  <>
                    <NumberField label="Timelønn" value={r.hourlyWage} max={100000} onChange={(v) => setRole(r.id, { hourlyWage: v })} suffix="kr/t" />
                    <NumberField label="Feriepenger" value={r.holidayPayPercent} max={100} onChange={(v) => setRole(r.id, { holidayPayPercent: v })} suffix="%" hint="10,2 % etter ferieloven, 12 % ved fem uker" />
                    <NumberField label="Pensjon" value={r.pensionPercent} max={100} onChange={(v) => setRole(r.id, { pensionPercent: v })} suffix="%" hint="OTP minst 2 %" />
                    <NumberField label="Arbeidsgiveravgift" value={r.employerTaxPercent} max={100} onChange={(v) => setRole(r.id, { employerTaxPercent: v })} suffix="%" hint="14,1 % i sone 1. Lavere i andre soner" />
                    <NumberField label="Andre personalkostnader" value={r.otherPercent} max={100} onChange={(v) => setRole(r.id, { otherPercent: v })} suffix="%" hint="Av timelønn: forsikring, kurs, arbeidsklær" />
                  </>
                )}
              </div>
              <div className="cost-role-footer">
                <span>Timekostnad: <strong>{formatMoney(h.total, f)}</strong>
                  {r.mode === 'detaljert' && <span className="muted small"> (lønn {formatMoney(h.wage, f)} + feriepenger {formatMoney(h.holidayPay, f)} + pensjon {formatMoney(h.pension, f)} + AGA {formatMoney(h.employerTax, f)} + andre {formatMoney(h.other, f)})</span>}
                </span>
                {!readOnly && (
                  <button className="icon-btn danger" aria-label={`Slett ${r.name || 'rolle'}`} onClick={() => {
                    if (!usedRoles.has(r.id) || confirm(`«${r.name}» brukes i oppskrifter. Arbeidstiden der blir da ikke regnet med. Slette likevel?`)) {
                      set({ staffRoles: draft.staffRoles.filter((x) => x.id !== r.id) })
                    }
                  }}><Trash2 size={16} /></button>
                )}
              </div>
            </fieldset>
          )
        })}
        {!readOnly && (
          <button className="btn ghost" onClick={() => set({ staffRoles: [...draft.staffRoles, defaultStaffRole(uid(), draft.staffRoles.length ? '' : 'Kokk')] })}>
            <Plus size={16} /> Legg til rolle
          </button>
        )}
        <Notice>Satsene er forslag. Kontroller arbeidsgiveravgiften for din sone og feriepenger og pensjon etter avtalene deres.</Notice>
      </Card>

      <Card title="Driftskostnader" icon={Building}>
        <p className="muted small">Faste kostnader per måned fordeles likt på alt dere produserer. Oppgi omtrent hvor mange stk eller porsjoner dere lager per måned.</p>
        {draft.operatingCosts.map((c) => (
          <div key={c.id} className="labor-row">
            <div className="field">
              <label htmlFor={`oc-${c.id}`}>Kostnad</label>
              <input id={`oc-${c.id}`} list="oc-suggestions" value={c.name} disabled={readOnly} onChange={(e) => setCost(c.id, { name: e.target.value })} placeholder="F.eks. Husleie" />
            </div>
            <NumberField label="Per måned" value={c.amountPerMonth} max={100000000} disabled={readOnly} onChange={(v) => setCost(c.id, { amountPerMonth: v })} suffix="kr" />
            {!readOnly && <button className="icon-btn danger" aria-label={`Slett ${c.name || 'kostnad'}`} onClick={() => set({ operatingCosts: draft.operatingCosts.filter((x) => x.id !== c.id) })}><Trash2 size={16} /></button>}
          </div>
        ))}
        <datalist id="oc-suggestions">{OPERATING_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
        {!readOnly && <button className="btn ghost" onClick={() => set({ operatingCosts: [...draft.operatingCosts, { id: uid(), name: '', amountPerMonth: 0 }] })}><Plus size={16} /> Legg til kostnad</button>}
        <div className="form-grid">
          <Toggle label="Ta med strøm til kjøl, frys og ventilasjon" checked={draft.includeContinuousEquipment} onChange={(v) => !readOnly && set({ includeContinuousEquipment: v })}
            hint={`Fra utstyrsregisteret: ${formatKwh(oh.equipmentKwhPerMonth || 0, f.locale)} per måned`} />
          <NumberField label="Produksjon per måned" value={draft.unitsPerMonth} integer max={10000000} disabled={readOnly} onChange={(v) => set({ unitsPerMonth: v })} suffix="stk/porsjoner" />
        </div>
        <dl className="kv">
          <dt>Faste kostnader</dt><dd>{formatMoney(oh.fixedPerMonth, f)} / mnd</dd>
          {draft.includeContinuousEquipment && <><dt>Strøm, kontinuerlig utstyr</dt><dd>{formatMoney(oh.equipmentPerMonth, f)} / mnd</dd></>}
          <dt>Totalt</dt><dd><strong>{formatMoney(oh.totalPerMonth, f)} / mnd</strong></dd>
          <dt>Per stk/porsjon</dt><dd><strong>{oh.perUnit === null ? '–' : formatMoney(oh.perUnit, f)}</strong></dd>
        </dl>
        {oh.totalPerMonth > 0 && oh.perUnit === null && <Notice tone="warn">Oppgi produksjon per måned, ellers blir driftskostnadene ikke fordelt.</Notice>}
        <p className="muted small">Strøm til kontinuerlig utstyr regnes med {source}.</p>
      </Card>

      {!readOnly && dirty && (
        <div className="actions">
          <button className="btn primary" disabled={!valid} onClick={save}><Save size={18} /> Lagre endringer</button>
          <button className="btn ghost" onClick={() => setDraft(data.costs)}>Angre</button>
        </div>
      )}
    </>
  )
}
