import { Plus, Trash2 } from 'lucide-react'
import type { LaborLine, StaffRole } from '../types'
import { NumberField, Notice, SelectField } from './ui'
import { formatMoney, formatNumber, uid } from '../utils/format'
import { hourlyCost } from '../utils/staffCosts'
import { navigate } from '../hooks/useRoute'
import { useFormat } from '../hooks/useData'

/** Arbeidstid for hele oppskriften: rolle × antall personer × minutter per person. */
export function LaborEditor({ lines, roles, onChange, canEditRoles }: { lines: LaborLine[]; roles: StaffRole[]; onChange: (l: LaborLine[]) => void; canEditRoles: boolean }) {
  const f = useFormat()
  const update = (id: string, p: Partial<LaborLine>) => onChange(lines.map((l) => (l.id === id ? { ...l, ...p } : l)))
  if (roles.length === 0) {
    return (
      <Notice>
        Legg inn roller med timelønn under{' '}
        {canEditRoles ? <button className="link" onClick={() => navigate('kostnader')}>Kostnader</button> : 'Kostnader (eier eller administrator)'}
        {' '}for å regne med arbeidstid.
      </Notice>
    )
  }
  return (
    <>
      {lines.map((l, idx) => {
        const role = roles.find((r) => r.id === l.roleId)
        const cost = role ? (l.people * l.minutes / 60) * hourlyCost(role).total : null
        return (
          <div key={l.id} className="labor-row">
            <SelectField label={idx === 0 ? 'Rolle' : ''} value={l.roleId} onChange={(v) => update(l.id, { roleId: v })}
              options={[...(role ? [] : [{ value: l.roleId, label: 'Slettet rolle' }]), ...roles.map((r) => ({ value: r.id, label: r.name }))]} />
            <NumberField label={idx === 0 ? 'Personer' : ''} value={l.people} min={0} max={1000} onChange={(v) => update(l.id, { people: v })} />
            <NumberField label={idx === 0 ? 'Minutter per person' : ''} value={l.minutes} min={0} max={100000} integer onChange={(v) => update(l.id, { minutes: v })} suffix="min" />
            <span className="num row-cost">{formatMoney(cost, f)}</span>
            <button className="icon-btn danger" aria-label="Fjern arbeidstid" onClick={() => onChange(lines.filter((x) => x.id !== l.id))}><Trash2 size={16} /></button>
          </div>
        )
      })}
      <button className="btn ghost" onClick={() => onChange([...lines, { id: uid(), roleId: roles[0].id, people: 1, minutes: 30 }])}><Plus size={16} /> Legg til arbeidstid</button>
      {lines.length > 0 && (
        <p className="muted small">
          Totalt {formatNumber(lines.reduce((s, l) => s + l.people * l.minutes, 0) / 60, 2, f.locale)} timer for hele oppskriften. Timekostnad inkluderer feriepenger, pensjon og arbeidsgiveravgift.
        </p>
      )}
    </>
  )
}
