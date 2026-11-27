import { useState } from 'react'
import { Coins, Croissant, History, PiggyBank, Plus, Trash2, TrendingUp, Zap } from 'lucide-react'
import { BAKE_TYPES, type BakeLog, type BakeType } from '../types'
import { useData, useFormat, useT } from '../hooks/useData'
import { useBakeResult } from '../hooks/useBakeResult'
import { useBusiness } from '../hooks/useBusiness'
import { Card, EmptyState, NumberField, PageHeader, Segmented, SelectField, StatCard, TextField } from '../components/ui'
import { filterByPeriod, summarize, type StatPeriod } from '../utils/stats'
import { formatDate, formatKwh, formatMoney, formatOre, toLocalDateKey, uid } from '../utils/format'

export function HistoryPage() {
  const t = useT()
  const f = useFormat()
  const { data, draft, addLog, deleteLog } = useData()
  const { result, pricePerKwh } = useBakeResult()
  const { profile } = useBusiness()
  const [period, setPeriod] = useState<StatPeriod>('month')
  const [form, setForm] = useState<(BakeLog & { dateKey: string }) | null>(null)

  const logs = filterByPeriod(data.history, period).sort((a, b) => b.date.localeCompare(a.date))
  const s = summarize(logs)

  const startNew = () => setForm({
    id: uid(), date: '', dateKey: toLocalDateKey(new Date()), recipeId: draft.recipeId, recipeName: draft.name || 'Bakst', type: draft.type,
    count: draft.count, kwh: result.energy.totalKwh, pricePerKwh, electricityCost: result.electricityCost, ingredientCost: result.ingredientCost,
    totalCost: result.totalCost, costPerItem: result.costPerItem ?? 0, storePricePerItem: draft.storePricePerItem, revenue: null, profit: null, note: '',
  })

  const saveForm = async () => {
    if (!form) return
    const electricityCost = form.kwh * form.pricePerKwh
    const totalCost = electricityCost + form.ingredientCost
    const { dateKey, ...rest } = form
    await addLog({
      ...rest,
      date: new Date(`${dateKey}T12:00:00`).toISOString(),
      electricityCost, totalCost,
      costPerItem: form.count > 0 ? totalCost / form.count : 0,
      profit: form.revenue !== null ? form.revenue - totalCost : null,
    })
    setForm(null)
  }

  return (
    <>
      <PageHeader title={profile.historyName} description="Kostnadene lagres som de var da de ble registrert – senere prisendringer påvirker ikke historikken."
        actions={<button className="btn primary" onClick={startNew}><Plus size={18} /> Registrer {profile.productionWord}</button>} />

      {form && (
        <Card title={`Registrer gjennomført ${profile.productionWord}`} icon={History}>
          <p className="muted small">Forhåndsutfylt fra kalkulatoren. Juster ved behov.</p>
          <div className="form-grid">
            <TextField label="Dato" type="date" value={form.dateKey} onChange={(v) => setForm({ ...form, dateKey: v })} />
            <SelectField label="Oppskrift" value={form.recipeId ?? ''} onChange={(v) => { const r = data.recipes.find((x) => x.id === v); setForm({ ...form, recipeId: v || null, recipeName: r?.name ?? form.recipeName, type: r?.type ?? form.type }) }}
              options={[{ value: '', label: '— Ingen —' }, ...data.recipes.map((r) => ({ value: r.id, label: r.name }))]} />
            <TextField label="Navn" required value={form.recipeName} onChange={(v) => setForm({ ...form, recipeName: v })} />
            <SelectField<BakeType> label="Type" value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={BAKE_TYPES.map((b) => ({ value: b, label: t(`bakeType.${b}`) }))} />
            <NumberField label="Antall" value={form.count} integer min={1} onChange={(v) => setForm({ ...form, count: v })} suffix="stk" />
            <NumberField label="Strømforbruk" value={Math.round(form.kwh * 1000) / 1000} onChange={(v) => setForm({ ...form, kwh: v })} suffix="kWh" />
            <NumberField label="Strømpris" min={-1000} hint="Kan være negativ" value={Math.round(form.pricePerKwh * 10000) / 100} onChange={(v) => setForm({ ...form, pricePerKwh: v / 100 })} suffix="øre/kWh" />
            <NumberField label="Ingredienskostnad" value={Math.round(form.ingredientCost * 100) / 100} onChange={(v) => setForm({ ...form, ingredientCost: v })} suffix="kr" />
            <NumberField label="Butikkpris" value={form.storePricePerItem} onChange={(v) => setForm({ ...form, storePricePerItem: v })} suffix="kr/stk" />
            <NumberField label="Salgsinntekt (valgfritt)" value={form.revenue ?? 0} onChange={(v) => setForm({ ...form, revenue: v > 0 ? v : null })} suffix="kr" hint="Eks. mva. La stå 0 hvis ikke solgt." />
          </div>
          <p className="callout">Totalkostnad: <strong>{formatMoney(form.kwh * form.pricePerKwh + form.ingredientCost, f)}</strong></p>
          <div className="actions">
            <button className="btn primary" disabled={!form.recipeName.trim() || !form.dateKey} onClick={saveForm}>Lagre</button>
            <button className="btn ghost" onClick={() => setForm(null)}>Avbryt</button>
          </div>
        </Card>
      )}

      <Segmented<StatPeriod> label="Periode" value={period} onChange={setPeriod}
        options={[{ value: 'week', label: 'Denne uken' }, { value: 'month', label: 'Denne måneden' }, { value: 'year', label: 'I år' }, { value: 'all', label: 'Alt' }]} />

      <div className="stats-grid">
        <StatCard icon={Croissant} label="Bakervarer" value={`${s.items} stk`} sub={`${s.bakes} bakinger`} />
        <StatCard icon={Zap} label="Strømforbruk" value={formatKwh(s.kwh, f.locale)} sub={formatMoney(s.electricityCost, f)} />
        <StatCard icon={Coins} label="Totale kostnader" value={formatMoney(s.totalCost, f)} sub={`Snitt ${formatMoney(s.avgCostPerItem, f)}/stk`} />
        <StatCard icon={PiggyBank} label="Spart vs. butikk" value={formatMoney(s.savings, f)} tone={s.savings >= 0 ? 'green' : 'red'} />
        {s.revenue > 0 && <StatCard icon={TrendingUp} label="Salg / fortjeneste" value={formatMoney(s.profit, f)} sub={`Omsetning ${formatMoney(s.revenue, f)}`} tone={s.profit >= 0 ? 'green' : 'red'} />}
      </div>

      {data.history.length === 0 ? (
        <EmptyState icon={History} title="Ingen bakinger registrert" text="Lagre en baking fra kalkulatoren eller registrer den her, så bygger du opp statistikk over tid."
          action={<button className="btn primary" onClick={startNew}><Plus size={18} /> Registrer baking</button>} />
      ) : logs.length === 0 ? (
        <Card><p className="muted">Ingen bakinger i valgt periode.</p></Card>
      ) : (
        <Card>
          <div className="table-wrap">
            <table className="clean responsive">
              <thead><tr><th>Dato</th><th>Bakst</th><th className="num">Antall</th><th className="num">Strøm</th><th className="num">Ingredienser</th><th className="num">Totalt</th><th className="num">Per stk</th><th className="num">Fortjeneste</th><th /></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td data-label="Dato">{formatDate(l.date, f.locale)}</td>
                    <td data-label="Bakst"><strong>{l.recipeName}</strong><small className="muted block">{t(`bakeType.${l.type}`)}</small></td>
                    <td data-label="Antall" className="num">{l.count}</td>
                    <td data-label="Strøm" className="num">{formatMoney(l.electricityCost, f)}<small className="muted block">{formatKwh(l.kwh, f.locale)} · {formatOre(l.pricePerKwh, f.locale)}</small></td>
                    <td data-label="Ingredienser" className="num">{formatMoney(l.ingredientCost, f)}</td>
                    <td data-label="Totalt" className="num"><strong>{formatMoney(l.totalCost, f)}</strong></td>
                    <td data-label="Per stk" className="num">{formatMoney(l.costPerItem, f)}</td>
                    <td data-label="Fortjeneste" className={`num ${l.profit !== null ? (l.profit >= 0 ? 'pos' : 'neg') : ''}`}>{l.profit !== null ? formatMoney(l.profit, f) : '–'}</td>
                    <td className="row-actions"><button className="icon-btn danger" aria-label="Slett baking" onClick={() => confirm('Slette denne bakingen fra historikken?') && deleteLog(l.id)}><Trash2 size={16} /></button></td>
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
