import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, ClipboardCheck, Package, Search, Warehouse } from 'lucide-react'
import type { Id, StockKind, StockMovement } from '../types'
import { useData, useFormat } from '../hooks/useData'
import { useFeature } from '../hooks/useFeature'
import { Card, EmptyState, Notice, NumberField, PageHeader, StatCard, TextField } from '../components/ui'
import { BusinessLocked } from '../components/BusinessLocked'
import { formatDateTime, formatMoney, formatNumber, uid } from '../utils/format'
import { stockOverview, unitCostOf } from '../utils/inventory'
import { navigate } from '../hooks/useRoute'

const KIND_NAMES: Record<StockKind, string> = { innkjop: 'Innkjøp', forbruk: 'Forbruk', svinn: 'Svinn', telling: 'Telling', justering: 'Justering' }

type Action = { ingredientId: Id; kind: 'innkjop' | 'forbruk' | 'telling' }

/** Lagerbeholdning per ingrediens, med innkjøp, uttak og varetelling (Business). */
export function StockPage() {
  const f = useFormat()
  const { data, addStockMovements, stockCount } = useData()
  const feature = useFeature('inventory')
  const [query, setQuery] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const [qty, setQty] = useState(0)
  const [note, setNote] = useState('')

  const rows = useMemo(() => stockOverview(data.ingredients, data.stockLevels)
    .filter((r) => r.ingredient.name.toLowerCase().includes(query.toLowerCase()))
    .filter((r) => !onlyLow || r.low)
    .sort((a, b) => Number(b.low) - Number(a.low) || a.ingredient.name.localeCompare(b.ingredient.name, 'nb')), [data.ingredients, data.stockLevels, query, onlyLow])
  const all = stockOverview(data.ingredients, data.stockLevels)
  const totalValue = all.reduce((s, r) => s + r.value, 0)
  const lowCount = all.filter((r) => r.low).length
  const nameOf = (id: Id) => data.ingredients.find((i) => i.id === id)?.name ?? 'Slettet ingrediens'

  if (!feature.allowed) {
    return <><PageHeader title="Lager" /><BusinessLocked what="Lagerstyring" loggedIn={feature.loggedIn} /></>
  }

  const open = (ingredientId: Id, kind: Action['kind']) => {
    setAction({ ingredientId, kind })
    setQty(kind === 'telling' ? Math.max(0, data.stockLevels[ingredientId] ?? 0) : 0)
    setNote('')
  }

  const submit = async () => {
    if (!action) return
    const ing = data.ingredients.find((i) => i.id === action.ingredientId)
    if (!ing) return
    if (action.kind === 'telling') {
      await stockCount(ing.id, qty, unitCostOf(ing), note)
    } else {
      const m: StockMovement = {
        id: uid(), ingredientId: ing.id, quantity: action.kind === 'innkjop' ? qty : -qty, kind: action.kind,
        movedAt: new Date().toISOString(), unitCost: unitCostOf(ing), note,
      }
      await addStockMovements([m])
    }
    setAction(null)
  }

  const current = action ? data.ingredients.find((i) => i.id === action.ingredientId) : null
  return (
    <>
      <PageHeader title="Lager" description="Beholdning i ingrediensens egen enhet. Innkjøp legger til, forbruk og svinn trekker fra, og telling setter beholdningen." />
      <div className="stats-grid">
        <StatCard label="Lagerverdi" value={formatMoney(totalValue, f, 0)} sub="Etter dagens innkjøpspriser" icon={Warehouse} />
        <StatCard label="Under minimum" value={String(lowCount)} sub={lowCount ? 'Bør bestilles' : 'Alt i orden'} icon={AlertTriangle} tone={lowCount ? 'amber' : 'default'} />
        <StatCard label="Varer på lager" value={String(all.filter((r) => r.quantity > 0).length)} sub={`av ${all.length} ingredienser`} icon={Package} />
      </div>

      {current && action && (
        <Card title={`${action.kind === 'innkjop' ? 'Innkjøp' : action.kind === 'forbruk' ? 'Uttak' : 'Varetelling'}: ${current.name}`} icon={action.kind === 'telling' ? ClipboardCheck : action.kind === 'innkjop' ? ArrowDownCircle : ArrowUpCircle}>
          <div className="form-grid">
            <NumberField label={action.kind === 'telling' ? 'Talt beholdning' : 'Mengde'} value={qty} max={100000000} onChange={setQty} suffix={current.unit}
              hint={action.kind === 'telling' ? `Nå registrert: ${formatNumber(data.stockLevels[current.id] ?? 0, 3, f.locale)} ${current.unit}` : `Pakning: ${current.packageSize} ${current.unit}`} />
            <TextField label="Notat" value={note} onChange={setNote} placeholder={action.kind === 'innkjop' ? 'F.eks. faktura 1234' : ''} />
          </div>
          <div className="actions">
            <button className="btn primary" disabled={action.kind !== 'telling' && !(qty > 0)} onClick={submit}>Lagre</button>
            <button className="btn ghost" onClick={() => setAction(null)}>Avbryt</button>
          </div>
        </Card>
      )}

      {data.ingredients.length === 0 ? (
        <EmptyState icon={Warehouse} title="Ingen ingredienser" text="Legg inn ingredienser først. Deretter kan du registrere innkjøp og telle lageret."
          action={<button className="btn primary" onClick={() => navigate('ingredienser')}>Til ingredienser</button>} />
      ) : (
        <Card>
          <div className="toolbar">
            <div className="search"><Search size={16} aria-hidden /><input aria-label="Søk" placeholder="Søk i lageret …" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
            <label className="check"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Bare under minimum</label>
          </div>
          <div className="table-wrap">
            <table className="clean responsive">
              <thead><tr><th>Ingrediens</th><th className="num">Beholdning</th><th className="num">Minimum</th><th className="num">Verdi</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ingredient.id} className={r.low ? 'warn-row' : ''}>
                    <td data-label="Ingrediens"><strong>{r.ingredient.name}</strong>{r.low && <small className="warn-text block">Under minimum</small>}</td>
                    <td data-label="Beholdning" className={`num ${r.quantity < 0 ? 'neg' : ''}`}>{formatNumber(r.quantity, 2, f.locale)} {r.ingredient.unit}</td>
                    <td data-label="Minimum" className="num">{r.ingredient.minStock === null ? '–' : `${formatNumber(r.ingredient.minStock, 2, f.locale)} ${r.ingredient.unit}`}</td>
                    <td data-label="Verdi" className="num">{formatMoney(r.value, f)}</td>
                    <td className="row-actions">
                      <button className="btn ghost small" onClick={() => open(r.ingredient.id, 'innkjop')}>Inn</button>
                      <button className="btn ghost small" onClick={() => open(r.ingredient.id, 'forbruk')}>Ut</button>
                      <button className="btn ghost small" onClick={() => open(r.ingredient.id, 'telling')}>Tell</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <p className="muted">Ingen treff.</p>}
          <p className="muted small">Minimumsbeholdning settes på ingrediensen. Negativ beholdning betyr at mer er tatt ut enn registrert inn – tell lageret for å rette det.</p>
        </Card>
      )}

      {data.stockMovements.length > 0 && (
        <Card title="Siste bevegelser">
          {data.stockMovements.some((m) => m.quantity < 0 && m.kind === 'forbruk') ? null : <Notice>Forbruk kan trekkes automatisk når du lagrer en produksjon i kalkulatoren.</Notice>}
          <div className="table-wrap">
            <table className="clean responsive">
              <thead><tr><th>Tid</th><th>Ingrediens</th><th>Type</th><th className="num">Mengde</th><th>Notat</th></tr></thead>
              <tbody>
                {data.stockMovements.slice(0, 50).map((m) => {
                  const ing = data.ingredients.find((i) => i.id === m.ingredientId)
                  return (
                    <tr key={m.id}>
                      <td data-label="Tid">{formatDateTime(m.movedAt, f.locale)}</td>
                      <td data-label="Ingrediens">{nameOf(m.ingredientId)}</td>
                      <td data-label="Type">{KIND_NAMES[m.kind]}</td>
                      <td data-label="Mengde" className={`num ${m.quantity < 0 ? 'neg' : 'pos'}`}>{m.quantity > 0 ? '+' : ''}{formatNumber(m.quantity, 3, f.locale)} {ing?.unit ?? ''}</td>
                      <td data-label="Notat">{m.note || <span className="muted">–</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}
