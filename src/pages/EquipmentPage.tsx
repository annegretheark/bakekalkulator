import { useState } from 'react'
import { ArrowLeft, Pencil, Plus, Refrigerator, Snowflake, Trash2, Wrench, Zap } from 'lucide-react'
import { EQUIPMENT_TYPES, type EquipmentItem, type EquipmentType } from '../types'
import { useData, useFormat } from '../hooks/useData'
import { usePriceData } from '../hooks/usePriceData'
import { Card, EmptyState, Notice, NumberField, PageHeader, Segmented, SelectField, TextField, Toggle } from '../components/ui'
import { EQUIPMENT_TYPE_NAMES, equipmentFromTemplate } from '../lib/equipmentTemplates'
import { continuousDailyKwh, continuousMonthlyKwh, runKwh } from '../utils/equipment'
import { formatKwh, formatMoney, formatNumber, uid } from '../utils/format'

type PowerUnit = 'W' | 'kW'

function EquipmentForm({ initial, onSave, onCancel }: { initial: EquipmentItem; onSave: (e: EquipmentItem) => Promise<void>; onCancel: () => void }) {
  const [e, setE] = useState(initial)
  const [unit, setUnit] = useState<PowerUnit>(initial.watt >= 10000 ? 'kW' : 'W')
  const [busy, setBusy] = useState(false)
  const set = (p: Partial<EquipmentItem>) => setE((x) => ({ ...x, ...p }))
  // Endrer kunden tallene, er de ikke lenger rene anslag fra malen
  const setMeasured = (p: Partial<EquipmentItem>) => set({ ...p, isEstimate: false })
  const valid = e.name.trim() && e.watt > 0 && e.watt <= 100000

  return (
    <>
      <PageHeader title={initial.name ? `Rediger ${initial.name}` : 'Nytt utstyr'}
        actions={<button className="btn ghost" onClick={onCancel}><ArrowLeft size={16} /> Tilbake</button>} />
      {e.isEstimate && (
        <Notice tone="warn">Verdiene er <strong>anslag</strong> fra en mal. Legg inn effekten fra typeskiltet på ditt eget utstyr for riktigere beregninger.</Notice>
      )}
      <div className="grid-2">
        <div className="stack">
          <Card title="Enhet" icon={Wrench}>
            <div className="form-grid">
              <TextField label="Navn" required value={e.name} onChange={(v) => set({ name: v })} placeholder="F.eks. Dekkovn 1" />
              <SelectField<EquipmentType> label="Type" value={e.type} onChange={(v) => set({ type: v })}
                options={EQUIPMENT_TYPES.map((t) => ({ value: t, label: EQUIPMENT_TYPE_NAMES[t] }))} />
              <TextField label="Produsent" value={e.manufacturer} onChange={(v) => set({ manufacturer: v })} />
              <TextField label="Modell" value={e.model} onChange={(v) => set({ model: v })} />
            </div>
          </Card>
          <Card title="Effekt og bruk" icon={Zap}>
            <div className="field">
              <span className="label">Effekt oppgis i</span>
              <Segmented<PowerUnit> label="Effekt oppgis i" value={unit} onChange={setUnit} options={[{ value: 'W', label: 'W' }, { value: 'kW', label: 'kW' }]} />
            </div>
            <div className="form-grid">
              <NumberField label="Effekt" value={unit === 'kW' ? e.watt / 1000 : e.watt} suffix={unit} max={unit === 'kW' ? 100 : 100000}
                onChange={(v) => setMeasured({ watt: unit === 'kW' ? v * 1000 : v })} hint="Står på typeskiltet" />
              <Toggle label="Går hele tiden" checked={e.continuous} onChange={(v) => set({ continuous: v })}
                hint="Kjøleskap, fryser og ventilasjon: felles driftskostnad, ikke per oppskrift." />
            </div>
            {e.continuous ? (
              <div className="form-grid">
                <NumberField label="Driftstimer per døgn" value={e.hoursPerDay} suffix="t" max={24} onChange={(v) => setMeasured({ hoursPerDay: v })} />
                <NumberField label="Effektandel i snitt" value={e.powerPercent} suffix="%" max={100} onChange={(v) => setMeasured({ powerPercent: v })}
                  hint="Kompressoren går av og på – ofte 30–50 %" />
              </div>
            ) : (
              <div className="form-grid">
                <NumberField label="Forvarmingstid" value={e.preheatMinutes} suffix="min" max={1440} onChange={(v) => setMeasured({ preheatMinutes: v })} />
                <NumberField label="Effektandel under forvarming" value={e.preheatPowerPercent} suffix="%" max={100} onChange={(v) => setMeasured({ preheatPowerPercent: v })} />
                <NumberField label="Effektandel under normal drift" value={e.powerPercent} suffix="%" max={100} onChange={(v) => setMeasured({ powerPercent: v })} hint="Termostaten slår av og på – typisk 40–70 %" />
                <NumberField label="Normal brukstid per produksjon" value={e.minutes} suffix="min" max={10080} onChange={(v) => setMeasured({ minutes: v })} />
                <NumberField label="Antall produkter/porsjoner per produksjon" value={e.outputPerRun ?? 0} integer max={1000000} onChange={(v) => set({ outputPerRun: v > 0 ? v : null })}
                  hint="Kapasitet. Brukes til å foreslå antall omganger." />
                <NumberField label="Målt strømforbruk per produksjon" value={e.measuredKwh ?? 0} suffix="kWh" max={100000} onChange={(v) => setMeasured({ measuredKwh: v > 0 ? v : null })}
                  hint="Valgfritt. Erstatter anslaget, inkl. forvarming." />
              </div>
            )}
          </Card>
        </div>
        <div className="stack">
          <Card title="Kommentar" icon={Pencil}>
            <div className="field"><label htmlFor="eq-comment">Kommentar</label><textarea id="eq-comment" rows={3} value={e.comment} onChange={(ev) => set({ comment: ev.target.value })} /></div>
            {e.isEstimate && <Toggle label="Verdiene er kontrollert" checked={!e.isEstimate} onChange={(v) => set({ isEstimate: !v })} hint="Fjerner merkingen som anslag." />}
          </Card>
          <div className="actions">
            <button className="btn primary" disabled={!valid || busy} onClick={async () => { setBusy(true); try { await onSave({ ...e, name: e.name.trim() }) } finally { setBusy(false) } }}>Lagre utstyr</button>
            <button className="btn ghost" onClick={onCancel}>Avbryt</button>
          </div>
        </div>
      </div>
    </>
  )
}

export function EquipmentPage() {
  const f = useFormat()
  const { data, upsertEquipment, deleteEquipment } = useData()
  const prices = usePriceData()
  const [editing, setEditing] = useState<EquipmentItem | null>(null)
  const [template, setTemplate] = useState<EquipmentType | ''>('')
  const price = prices.todayAverage ?? prices.currentTotal ?? data.settings.price.manualTotalKrPerKwh

  if (editing) {
    return <EquipmentForm initial={editing} onCancel={() => setEditing(null)} onSave={async (e) => { await upsertEquipment(e); setEditing(null) }} />
  }

  const production = data.equipment.filter((e) => !e.continuous)
  const continuous = data.equipment.filter((e) => e.continuous)
  const monthlyKwh = continuousMonthlyKwh(continuous)
  const usedIn = (id: string) => data.recipes.filter((r) => r.energy.equipmentUses?.some((u) => u.equipmentId === id)).length

  const row = (e: EquipmentItem) => (
    <tr key={e.id}>
      <td>
        <strong>{e.name}</strong>
        {e.isEstimate && <span className="pill" title="Verdiene er anslag fra en mal"> Anslag</span>}
        <small className="muted block">{EQUIPMENT_TYPE_NAMES[e.type]}{e.manufacturer || e.model ? ` · ${[e.manufacturer, e.model].filter(Boolean).join(' ')}` : ''}</small>
      </td>
      <td className="num">{e.watt >= 1000 ? `${formatNumber(e.watt / 1000, 1, f.locale)} kW` : `${formatNumber(e.watt, 0, f.locale)} W`}</td>
      {e.continuous
        ? <td className="num">{formatKwh(continuousDailyKwh(e) * 30, f.locale)}<small className="muted block">{formatMoney(continuousDailyKwh(e) * 30 * price, f)}/mnd</small></td>
        : <td className="num">{formatKwh(runKwh(e), f.locale)}<small className="muted block">{formatMoney(runKwh(e) * price, f)}{e.measuredKwh ? ' (målt)' : ''}</small></td>}
      <td className="num nowrap">
        <button className="icon-btn" aria-label={`Rediger ${e.name}`} onClick={() => setEditing(structuredClone(e))}><Pencil size={16} /></button>
        <button className="icon-btn danger" aria-label={`Slett ${e.name}`} onClick={() => {
          const n = usedIn(e.id)
          if (confirm(`Slette «${e.name}»?${n ? ` Den brukes i ${n} oppskrift(er), som beholder siste kjente verdier.` : ''}`)) deleteEquipment(e.id)
        }}><Trash2 size={16} /></button>
      </td>
    </tr>
  )

  return (
    <>
      <PageHeader title="Utstyr" description="Registrer ovner, maskiner og kjøleutstyr. Velg utstyret i oppskrifter og kalkulasjoner."
        actions={<button className="btn primary" onClick={() => setEditing({ ...equipmentFromTemplate('annet', uid()), name: '', isEstimate: false })}><Plus size={18} /> Nytt utstyr</button>} />

      <Card title="Legg til fra mal" icon={Plus}>
        <div className="form-grid">
          <SelectField<EquipmentType | ''> label="Type utstyr" value={template} onChange={setTemplate}
            options={[{ value: '', label: '— Velg type —' }, ...EQUIPMENT_TYPES.map((t) => ({ value: t, label: EQUIPMENT_TYPE_NAMES[t] }))]} />
        </div>
        <button className="btn ghost" disabled={!template} onClick={() => { if (template) { setEditing(equipmentFromTemplate(template, uid())); setTemplate('') } }}><Plus size={16} /> Bruk mal</button>
        <p className="muted small">Malene har typiske verdier merket som anslag. Kontroller effekten mot typeskiltet.</p>
      </Card>

      {data.equipment.length === 0 ? (
        <EmptyState icon={Wrench} title="Ingen utstyr registrert" text="Legg inn utstyret dere bruker, så kan oppskriftene beregne strømkostnaden med riktig effekt." />
      ) : (
        <>
          <Card title="Produksjonsutstyr" icon={Wrench}>
            {production.length === 0 ? <p className="muted">Ingen produksjonsutstyr registrert.</p> : (
              <div className="table-wrap">
                <table className="clean">
                  <thead><tr><th>Utstyr</th><th className="num">Effekt</th><th className="num">Per produksjon</th><th><span className="sr-only">Handlinger</span></th></tr></thead>
                  <tbody>{production.map(row)}</tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title="Kontinuerlig drift (felles driftskostnad)" icon={Refrigerator}>
            {continuous.length === 0 ? <p className="muted">Ingen kjøleskap, frysere eller ventilasjon registrert.</p> : (
              <>
                <div className="table-wrap">
                  <table className="clean">
                    <thead><tr><th>Utstyr</th><th className="num">Effekt</th><th className="num">Per måned</th><th><span className="sr-only">Handlinger</span></th></tr></thead>
                    <tbody>{continuous.map(row)}</tbody>
                    <tfoot><tr><td colSpan={2}>Sum per måned</td><td className="num">{formatKwh(monthlyKwh, f.locale)}<small className="muted block">{formatMoney(monthlyKwh * price, f)}</small></td><td /></tr></tfoot>
                  </table>
                </div>
                <p className="muted small"><Snowflake size={12} aria-hidden /> Anslag med dagens snittpris og 30 dager. Fordeling på produkter kommer med driftskostnadene i neste fase.</p>
              </>
            )}
          </Card>
        </>
      )}
    </>
  )
}
