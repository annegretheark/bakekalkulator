import { Plus, Trash2 } from 'lucide-react'
import type { EnergyInput, EquipmentItem, EquipmentUse } from '../types'
import { navigate } from '../hooks/useRoute'
import { runsNeeded, equipmentUseFrom } from '../utils/equipment'
import { uid } from '../utils/format'
import { Notice, NumberField, Segmented, SelectField, Toggle } from './ui'

/**
 * Velger hvordan strømforbruket beregnes: manuelt (ovn og kjøkkenmaskin som før)
 * eller med utstyr fra registeret. Med registeret teller bare det valgte utstyret,
 * så samme ovn ikke regnes to ganger.
 */
export function EquipmentUsesEditor({ energy, onChange, equipment, count, unitWord }: {
  energy: EnergyInput
  onChange: (e: EnergyInput) => void
  equipment: EquipmentItem[]
  count: number
  unitWord: string
}) {
  const source = energy.energySource ?? 'manual'
  const uses = energy.equipmentUses ?? []
  const selectable = equipment.filter((e) => !e.continuous)
  const available = selectable.filter((e) => !uses.some((u) => u.equipmentId === e.id))
  const setUses = (next: EquipmentUse[]) => onChange({ ...energy, equipmentUses: next })
  const setUse = (id: string, patch: Partial<EquipmentUse>) => setUses(uses.map((u) => (u.id === id ? { ...u, ...patch } : u)))

  const add = (equipmentId: string) => {
    const item = selectable.find((e) => e.id === equipmentId)
    if (item) setUses([...uses, equipmentUseFrom(item, uid(), runsNeeded(count, item.outputPerRun))])
  }

  return (
    <div className="stack">
      <Segmented<'manual' | 'equipment'> label="Strømberegning" value={source}
        onChange={(v) => onChange({ ...energy, energySource: v })}
        options={[{ value: 'manual', label: 'Manuelt oppsett' }, { value: 'equipment', label: 'Utstyr fra registeret' }]} />
      {source === 'manual' ? (
        <p className="muted small">Ovn, kjøkkenmaskin og annet utstyr legges inn for hånd i kalkulatoren.</p>
      ) : (
        <>
          {selectable.length === 0 && (
            <Notice tone="warn">Utstyrsregisteret er tomt. <button className="link" onClick={() => navigate('utstyr')}>Registrer utstyr</button> først.</Notice>
          )}
          {uses.map((u) => {
            const item = equipment.find((e) => e.id === u.equipmentId)
            const capacity = item?.outputPerRun ?? null
            const needed = runsNeeded(count, capacity)
            return (
              <div key={u.id} className="oven-block">
                <div className="oven-head">
                  <strong>{u.name}{!item && <small className="muted"> (slettet fra registeret)</small>}</strong>
                  <button className="icon-btn danger" aria-label={`Fjern ${u.name}`} onClick={() => setUses(uses.filter((x) => x.id !== u.id))}><Trash2 size={18} /></button>
                </div>
                <div className="form-grid">
                  <NumberField label="Driftstid per omgang" value={u.minutes} suffix="min" max={1440} onChange={(v) => setUse(u.id, { minutes: v })} />
                  <NumberField label="Antall omganger" value={u.runs} integer min={0} max={100} onChange={(v) => setUse(u.id, { runs: v })}
                    hint={capacity ? `Kapasitet ${capacity} ${unitWord} per omgang – ${needed} omgang(er) for ${count} ${unitWord}` : undefined} />
                </div>
                {u.preheatMinutes > 0 && (
                  <Toggle label={`Forvarm (${u.preheatMinutes} min)`} checked={u.preheat} onChange={(v) => setUse(u.id, { preheat: v })}
                    hint="Forvarming regnes én gang per enhet, uansett antall omganger." />
                )}
                {u.measuredKwh ? <p className="muted small">Bruker målt forbruk: {u.measuredKwh} kWh per omgang.</p> : null}
              </div>
            )
          })}
          {available.length > 0 && (
            <SelectField label="Legg til utstyr" value="" onChange={(v) => v && add(v)}
              options={[{ value: '', label: '— Velg utstyr —' }, ...available.map((e) => ({ value: e.id, label: e.name }))]} />
          )}
          {selectable.length > 0 && available.length === 0 && uses.length > 0 && <p className="muted small"><Plus size={12} aria-hidden /> Alt registrert utstyr er lagt til.</p>}
          <p className="muted small">Kjøleskap, frysere og annet utstyr som går hele tiden, regnes som felles driftskostnad og velges ikke her.</p>
        </>
      )}
    </div>
  )
}
