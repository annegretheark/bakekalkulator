import { Fragment, useMemo, useState } from 'react'
import { Plus, Recycle, Trash2 } from 'lucide-react'
import { UNITS, WASTE_REASONS, type Unit, type WasteLog, type WasteReason } from '../types'
import { useData, useFormat } from '../hooks/useData'
import { useFeature } from '../hooks/useFeature'
import { useRecipeBreakdown } from '../hooks/useRecipeCosts'
import { Card, EmptyState, Notice, NumberField, PageHeader, SelectField, StatCard, TextField, Toggle } from '../components/ui'
import { BusinessLocked } from '../components/BusinessLocked'
import { formatDate, formatMoney, formatNumber, toLocalDateKey, uid } from '../utils/format'
import { convert, unitDimension } from '../utils/units'
import { unitCostOf, WASTE_REASON_NAMES, wasteCostForIngredient, wasteSummary } from '../utils/inventory'

type Source = 'ingrediens' | 'oppskrift'

/** Registrering og oversikt over matsvinn (Business). Kostnaden lagres som den var på dagen. */
export function WastePage() {
  const f = useFormat()
  const { data, registerWaste, deleteWaste } = useData()
  const feature = useFeature('inventory')
  const breakdown = useRecipeBreakdown()
  const today = toLocalDateKey(new Date())
  const monthStart = `${today.slice(0, 8)}01`
  const [source, setSource] = useState<Source>('ingrediens')
  const [itemId, setItemId] = useState('')
  const [amount, setAmount] = useState(0)
  const [unit, setUnit] = useState<Unit>('g')
  const [reason, setReason] = useState<WasteReason>('utgatt')
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [deduct, setDeduct] = useState(true)
  const [open, setOpen] = useState(false)

  const month = useMemo(() => wasteSummary(data.waste, monthStart, today), [data.waste, monthStart, today])

  if (!feature.allowed) {
    return <><PageHeader title="Matsvinn" /><BusinessLocked what="Registrering av matsvinn" loggedIn={feature.loggedIn} /></>
  }

  const ing = source === 'ingrediens' ? data.ingredients.find((i) => i.id === itemId) : undefined
  const rec = source === 'oppskrift' ? data.recipes.find((r) => r.id === itemId) : undefined

  // Kostnad og lageruttak for det som registreres
  let cost: number | null = null
  let stockQty: number | null = null
  if (ing && amount > 0) {
    cost = wasteCostForIngredient(ing, amount, unit)
    stockQty = convert(amount, unit, ing.unit)
  }
  if (rec && amount > 0) {
    // Oppskrifter registreres i stk/porsjoner
    cost = breakdown(rec, amount).total
  }
  const canSave = !!itemId && amount > 0 && cost !== null

  const save = async () => {
    if (!canSave) return
    const w: WasteLog = {
      id: uid(), loggedAt: date, ingredientId: ing?.id ?? null, recipeId: rec?.id ?? null, name: ing?.name ?? rec?.name ?? 'Svinn',
      amount, unit: rec ? 'stk' : unit, cost: cost ?? 0, reason, note,
    }
    await registerWaste(w, ing && deduct ? stockQty : null, ing ? unitCostOf(ing) : 0)
    setAmount(0)
    setNote('')
    setOpen(false)
  }

  return (
    <>
      <PageHeader title="Matsvinn" description="Registrer det som kastes. Kostnaden beregnes med dagens priser og endres ikke senere."
        actions={<button className="btn primary" onClick={() => setOpen(true)}><Plus size={18} /> Registrer svinn</button>} />

      <div className="stats-grid">
        <StatCard label="Svinn denne måneden" value={formatMoney(month.total, f, 0)} sub={`${month.count} registreringer`} icon={Recycle} tone={month.total > 0 ? 'amber' : 'default'} />
        <StatCard label="Største årsak" value={month.byReason[0] ? WASTE_REASON_NAMES[month.byReason[0].reason] : '–'} sub={month.byReason[0] ? formatMoney(month.byReason[0].cost, f, 0) : ''} icon={Recycle} />
        <StatCard label="Mest kastet" value={month.top[0]?.name ?? '–'} sub={month.top[0] ? formatMoney(month.top[0].cost, f, 0) : ''} icon={Recycle} />
      </div>

      {open && (
        <Card title="Registrer svinn" icon={Recycle}>
          <div className="form-grid">
            <SelectField<Source> label="Hva ble kastet" value={source} onChange={(v) => { setSource(v); setItemId('') }}
              options={[{ value: 'ingrediens', label: 'Ingrediens / råvare' }, { value: 'oppskrift', label: 'Ferdig rett eller produkt' }]} />
            <SelectField label={source === 'ingrediens' ? 'Ingrediens' : 'Oppskrift'} value={itemId} onChange={(v) => {
              setItemId(v)
              const i = data.ingredients.find((x) => x.id === v)
              if (i) setUnit(unitDimension(i.unit) === 'mass' ? 'g' : unitDimension(i.unit) === 'volume' ? 'dl' : 'stk')
            }} options={[{ value: '', label: '— Velg —' }, ...(source === 'ingrediens' ? data.ingredients : data.recipes).map((x) => ({ value: x.id, label: x.name }))]} />
            <NumberField label="Mengde" value={amount} max={100000000} onChange={setAmount} suffix={rec ? (rec.yieldUnit === 'porsjoner' ? 'porsjoner' : 'stk') : undefined} />
            {source === 'ingrediens' && <SelectField<Unit> label="Enhet" value={unit} onChange={setUnit} options={UNITS.map((u) => ({ value: u, label: u }))} />}
            <SelectField<WasteReason> label="Årsak" value={reason} onChange={setReason} options={WASTE_REASONS.map((r) => ({ value: r, label: WASTE_REASON_NAMES[r] }))} />
            <TextField label="Dato" type="date" value={date} onChange={setDate} />
            <TextField label="Notat" value={note} onChange={setNote} />
            {source === 'ingrediens' && <Toggle label="Trekk fra lageret" checked={deduct} onChange={setDeduct} />}
          </div>
          {ing && amount > 0 && cost === null && <Notice tone="warn">Kan ikke regne {unit} om til {ing.unit}. Velg en {unitDimension(ing.unit) === 'mass' ? 'vektenhet' : unitDimension(ing.unit) === 'volume' ? 'volumenhet' : 'stk'}.</Notice>}
          {cost !== null && <p>Kostnad: <strong>{formatMoney(cost, f)}</strong></p>}
          <div className="actions">
            <button className="btn primary" disabled={!canSave} onClick={save}>Lagre</button>
            <button className="btn ghost" onClick={() => setOpen(false)}>Avbryt</button>
          </div>
        </Card>
      )}

      {month.byReason.length > 0 && (
        <Card title="Denne måneden etter årsak">
          <dl className="kv">
            {month.byReason.map((r) => <Fragment key={r.reason}><dt>{WASTE_REASON_NAMES[r.reason]} ({r.count})</dt><dd>{formatMoney(r.cost, f)}</dd></Fragment>)}
          </dl>
        </Card>
      )}

      {data.waste.length === 0 ? (
        <EmptyState icon={Recycle} title="Ingen svinn registrert" text="Registrer det som kastes – utgåtte varer, overproduksjon, tallerkensvinn – så ser dere hva svinnet koster og hva som kan gjøres annerledes."
          action={<button className="btn primary" onClick={() => setOpen(true)}><Plus size={18} /> Registrer svinn</button>} />
      ) : (
        <Card title="Registrert svinn">
          <div className="table-wrap">
            <table className="clean responsive">
              <thead><tr><th>Dato</th><th>Hva</th><th className="num">Mengde</th><th>Årsak</th><th className="num">Kostnad</th><th /></tr></thead>
              <tbody>
                {data.waste.slice(0, 200).map((w) => (
                  <tr key={w.id}>
                    <td data-label="Dato">{formatDate(w.loggedAt, f.locale)}</td>
                    <td data-label="Hva"><strong>{w.name}</strong>{w.note && <small className="muted block">{w.note}</small>}</td>
                    <td data-label="Mengde" className="num">{formatNumber(w.amount, 2, f.locale)} {w.unit}</td>
                    <td data-label="Årsak">{WASTE_REASON_NAMES[w.reason]}</td>
                    <td data-label="Kostnad" className="num">{formatMoney(w.cost, f)}</td>
                    <td className="row-actions">
                      <button className="icon-btn danger" aria-label={`Slett svinn ${w.name}`} onClick={() => confirm('Slette registreringen? Lageruttaket blir stående.') && deleteWaste(w.id)}><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}
