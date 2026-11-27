import { useState } from 'react'
import { ArrowLeft, BookOpen, Calculator, Clock, Copy, Pencil, Plus, Scale, ScanText, Trash2, Wheat } from 'lucide-react'
import { BAKE_TYPES, UNITS, type BakeType, type Recipe, type Unit } from '../types'
import { useData, useFormat, useT } from '../hooks/useData'
import { usePriceData } from '../hooks/usePriceData'
import { Card, EmptyState, Notice, NumberField, PageHeader, SelectField, TextField } from '../components/ui'
import { defaultEnergyInput } from '../lib/defaults'
import { computeBake } from '../utils/bake'
import { formatMoney, formatNumber, uid } from '../utils/format'
import { isCompatible } from '../utils/units'
import { navigate } from '../hooks/useRoute'
import { RecipeScanPanel } from '../components/ScanPanels'

const newRecipe = (): Recipe => {
  const now = new Date().toISOString()
  return { id: uid(), name: '', type: 'brod', yieldCount: 1, ingredients: [], steps: [''], riseMinutes: 60, bakeMinutes: 45, storePricePerItem: 0, notes: '', energy: defaultEnergyInput(), createdAt: now, updatedAt: now }
}

export function RecipesPage() {
  const t = useT()
  const f = useFormat()
  const { data, upsertRecipe, deleteRecipe, setDraft } = useData()
  const prices = usePriceData()
  const [editing, setEditing] = useState<Recipe | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [scaleTo, setScaleTo] = useState<number | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanInfo, setScanInfo] = useState<string | null>(null)
  const price = prices.todayAverage ?? prices.currentTotal ?? data.settings.price.manualTotalKrPerKwh

  const cost = (r: Recipe, count = r.yieldCount) => computeBake({
    energy: { ...r.energy, bakeMinutes: r.bakeMinutes || r.energy.bakeMinutes }, count, recipe: r, ingredients: data.ingredients,
    pricePerKwh: price, storePricePerItem: r.storePricePerItem, bakesPerMonth: data.settings.bakesPerMonth,
  })

  const openInCalculator = (r: Recipe, count = r.yieldCount) => {
    setDraft((d) => ({ ...d, recipeId: r.id, name: r.name, type: r.type, count, storePricePerItem: r.storePricePerItem, energy: { ...r.energy, bakeMinutes: r.bakeMinutes || r.energy.bakeMinutes } }))
    navigate('kalkulator')
  }

  const copy = (r: Recipe) => {
    const now = new Date().toISOString()
    upsertRecipe({ ...structuredClone(r), id: uid(), name: `${r.name} (kopi)`, ingredients: r.ingredients.map((i) => ({ ...i, id: uid() })), createdAt: now, updatedAt: now })
  }

  // ---------- Redigering ----------
  if (editing) {
    const e = editing
    const set = (p: Partial<Recipe>) => setEditing({ ...e, ...p })
    const valid = e.name.trim() && e.yieldCount > 0 && e.ingredients.every((i) => i.ingredientId && i.amount >= 0)
    const live = cost(e)
    return (
      <>
        <PageHeader title={data.recipes.some((r) => r.id === e.id) ? 'Rediger oppskrift' : 'Ny oppskrift'}
          actions={<button className="btn ghost" onClick={() => setEditing(null)}><ArrowLeft size={16} /> Tilbake</button>} />
        {scanInfo && <Notice>{scanInfo}</Notice>}
        <div className="grid-2 wide-left">
          <div className="stack">
            <Card title="Grunninfo" icon={BookOpen}>
              <div className="form-grid">
                <TextField label="Navn" required value={e.name} onChange={(v) => set({ name: v })} placeholder="F.eks. Grove brød" />
                <SelectField<BakeType> label="Type" value={e.type} onChange={(v) => set({ type: v })} options={BAKE_TYPES.map((b) => ({ value: b, label: t(`bakeType.${b}`) }))} />
                <NumberField label="Gir antall" value={e.yieldCount} integer min={1} onChange={(v) => set({ yieldCount: v })} suffix="stk" />
                <NumberField label="Hevetid" value={e.riseMinutes} onChange={(v) => set({ riseMinutes: v })} suffix="min" max={2880} />
                <NumberField label="Steketid" value={e.bakeMinutes} onChange={(v) => set({ bakeMinutes: v, energy: { ...e.energy, bakeMinutes: v } })} suffix="min" max={600} />
                <NumberField label="Butikkpris tilsvarende" value={e.storePricePerItem} onChange={(v) => set({ storePricePerItem: v })} suffix="kr/stk" />
              </div>
            </Card>

            <Card title="Ingredienser" icon={Wheat}>
              {data.ingredients.length === 0 && <Notice tone="warn">Registeret er tomt. <button className="link" onClick={() => navigate('ingredienser')}>Legg inn ingredienser</button> først.</Notice>}
              {e.ingredients.map((ri, idx) => {
                const ing = data.ingredients.find((i) => i.id === ri.ingredientId)
                const incompatible = ing && !isCompatible(ing.unit, ri.unit)
                return (
                  <div key={ri.id} className="ingredient-row">
                    <SelectField label={idx === 0 ? 'Ingrediens' : ''} value={ri.ingredientId} onChange={(v) => {
                      const target = data.ingredients.find((i) => i.id === v)
                      const unit: Unit = target && !isCompatible(target.unit, ri.unit) ? (target.unit === 'kg' ? 'g' : target.unit === 'l' ? 'dl' : target.unit) : ri.unit
                      set({ ingredients: e.ingredients.map((x) => (x.id === ri.id ? { ...x, ingredientId: v, unit } : x)) })
                    }} options={[{ value: '', label: '— Velg —' }, ...data.ingredients.map((i) => ({ value: i.id, label: i.name }))]} />
                    <NumberField label={idx === 0 ? 'Mengde' : ''} value={ri.amount} onChange={(v) => set({ ingredients: e.ingredients.map((x) => (x.id === ri.id ? { ...x, amount: v } : x)) })} />
                    <SelectField<Unit> label={idx === 0 ? 'Enhet' : ''} value={ri.unit} onChange={(v) => set({ ingredients: e.ingredients.map((x) => (x.id === ri.id ? { ...x, unit: v } : x)) })} options={UNITS.map((u) => ({ value: u, label: u }))} />
                    <span className="num row-cost">{formatMoney(live.ingredientLines[idx]?.cost ?? null, f)}</span>
                    <button className="icon-btn danger" aria-label="Fjern ingrediens" onClick={() => set({ ingredients: e.ingredients.filter((x) => x.id !== ri.id) })}><Trash2 size={16} /></button>
                    {incompatible && <small className="error full">Kan ikke regne {ri.unit} om til {ing.unit} uten kjent tetthet. Velg en {ing.unit === 'stk' ? 'stk' : ['g', 'kg'].includes(ing.unit) ? 'vektenhet' : 'volumenhet'}.</small>}
                  </div>
                )
              })}
              <button className="btn ghost" disabled={data.ingredients.length === 0} onClick={() => set({ ingredients: [...e.ingredients, { id: uid(), ingredientId: data.ingredients[0]?.id ?? '', amount: 100, unit: data.ingredients[0]?.unit === 'kg' ? 'g' : data.ingredients[0]?.unit ?? 'g' }] })}><Plus size={16} /> Legg til ingrediens</button>
            </Card>

            <Card title="Fremgangsmåte" icon={BookOpen}>
              <ol className="steps-edit">
                {e.steps.map((s, i) => (
                  <li key={i}>
                    <textarea value={s} rows={2} aria-label={`Steg ${i + 1}`} onChange={(ev) => set({ steps: e.steps.map((x, j) => (j === i ? ev.target.value : x)) })} />
                    <button className="icon-btn danger" aria-label={`Fjern steg ${i + 1}`} onClick={() => set({ steps: e.steps.filter((_, j) => j !== i) })}><Trash2 size={16} /></button>
                  </li>
                ))}
              </ol>
              <button className="btn ghost" onClick={() => set({ steps: [...e.steps, ''] })}><Plus size={16} /> Legg til steg</button>
              <div className="field"><label htmlFor="notes">Notater</label><textarea id="notes" rows={2} value={e.notes} onChange={(ev) => set({ notes: ev.target.value })} /></div>
            </Card>
          </div>

          <div className="stack sticky">
            <Card title="Kostnad" icon={Calculator}>
              <dl className="kv">
                <dt>Ingredienser</dt><dd>{formatMoney(live.ingredientCost, f)}</dd>
                <dt>Strøm (estimert)</dt><dd>{formatMoney(live.electricityCost, f)}</dd>
                <dt>Totalt</dt><dd><strong>{formatMoney(live.totalCost, f)}</strong></dd>
                <dt>Per stk</dt><dd><strong>{formatMoney(live.costPerItem, f)}</strong></dd>
                {live.savings && <><dt>Spart per baking</dt><dd>{formatMoney(live.savings.perBake, f)}</dd></>}
              </dl>
              {live.missingIngredientCosts > 0 && <Notice tone="warn">{live.missingIngredientCosts} ingrediens(er) kan ikke prisberegnes.</Notice>}
              <p className="muted small">Strøm estimeres med oppskriftens ovnsoppsett og dagens snittpris. Ovnsoppsettet justeres og lagres fra kalkulatoren.</p>
            </Card>
            <div className="actions">
              <button className="btn primary" disabled={!valid} onClick={async () => { setScanInfo(null); await upsertRecipe({ ...e, name: e.name.trim(), steps: e.steps.filter((s) => s.trim()), updatedAt: new Date().toISOString() }); setEditing(null); setViewing(e.id) }}>Lagre oppskrift</button>
              <button className="btn ghost" onClick={() => { setEditing(null); setScanInfo(null) }}>Avbryt</button>
            </div>
          </div>
        </div>
      </>
    )
  }

  // ---------- Visning av én oppskrift ----------
  const shown = viewing ? data.recipes.find((r) => r.id === viewing) : null
  if (shown) {
    const count = scaleTo ?? shown.yieldCount
    const res = cost(shown, count)
    return (
      <>
        <PageHeader title={shown.name} description={`${t(`bakeType.${shown.type}`)} · gir ${shown.yieldCount} stk`}
          actions={<>
            <button className="btn ghost" onClick={() => { setViewing(null); setScaleTo(null) }}><ArrowLeft size={16} /> Alle oppskrifter</button>
            <button className="btn ghost" onClick={() => setEditing(structuredClone(shown))}><Pencil size={16} /> Rediger</button>
            <button className="btn primary" onClick={() => openInCalculator(shown, count)}><Calculator size={16} /> Beregn</button>
          </>} />
        <div className="grid-2 wide-left">
          <div className="stack">
            <Card title="Ingredienser" icon={Wheat} actions={
              <div className="scale-ctl"><Scale size={16} aria-hidden /><NumberField label="Skaler til" value={count} integer min={1} max={1000} onChange={(v) => setScaleTo(v)} suffix="stk" /></div>
            }>
              <table className="clean">
                <thead><tr><th>Ingrediens</th><th className="num">Mengde</th><th className="num">Kostnad</th></tr></thead>
                <tbody>
                  {res.ingredientLines.map((l) => (
                    <tr key={l.recipeIngredientId} className={l.cost === null ? 'warn-row' : ''}>
                      <td>{l.name}{l.error && <small className="error block">{l.error}</small>}</td>
                      <td className="num">{formatNumber(l.amount, 1, f.locale)} {l.unit}</td>
                      <td className="num">{formatMoney(l.cost, f)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={2}>Sum</td><td className="num">{formatMoney(res.ingredientCost, f)}</td></tr></tfoot>
              </table>
            </Card>
            <Card title="Fremgangsmåte" icon={BookOpen}>
              {shown.steps.length ? <ol className="steps">{shown.steps.map((s, i) => <li key={i}>{s}</li>)}</ol> : <p className="muted">Ingen steg registrert.</p>}
              {shown.notes && <p className="muted">{shown.notes}</p>}
            </Card>
          </div>
          <div className="stack">
            <Card title="Kostnad" icon={Calculator}>
              <dl className="kv">
                <dt><Clock size={14} /> Hevetid</dt><dd>{shown.riseMinutes} min</dd>
                <dt><Clock size={14} /> Steketid</dt><dd>{shown.bakeMinutes} min</dd>
                <dt>Ingredienser</dt><dd>{formatMoney(res.ingredientCost, f)}</dd>
                <dt>Strøm</dt><dd>{formatMoney(res.electricityCost, f)}</dd>
                <dt>Totalt</dt><dd><strong>{formatMoney(res.totalCost, f)}</strong></dd>
                <dt>Per stk</dt><dd><strong>{formatMoney(res.costPerItem, f)}</strong></dd>
                <dt>Butikkpris</dt><dd>{shown.storePricePerItem ? formatMoney(shown.storePricePerItem, f) : '–'}</dd>
                {res.savings && <><dt>Spart per baking</dt><dd className="pos">{formatMoney(res.savings.perBake, f)}</dd></>}
              </dl>
            </Card>
          </div>
        </div>
      </>
    )
  }

  // ---------- Liste ----------
  return (
    <>
      <PageHeader title="Mine oppskrifter" description="Kostnadene beregnes automatisk fra ingrediensregisteret og dagens strømpris."
        actions={<>
          <button className="btn ghost" onClick={() => setScanning(true)}><ScanText size={18} /> Skann oppskrift</button>
          <button className="btn primary" onClick={() => setEditing(newRecipe())}><Plus size={18} /> Ny oppskrift</button>
        </>} />
      {scanning && (
        <RecipeScanPanel onCancel={() => setScanning(false)} onDone={(r, created) => {
          setScanning(false)
          setScanInfo(`Oppskriften er tolket fra bildet. Kontroller ingredienser, mengder og steg før du lagrer.${created ? ` ${created} ny(e) ingrediens(er) er lagt til uten pris – oppdater prisen under Ingredienser.` : ''}`)
          setEditing(r)
        }} />
      )}
      {data.recipes.length === 0 ? (
        <EmptyState icon={BookOpen} title="Ingen oppskrifter ennå" text="Lag din første oppskrift, så ser du hva hver bakst faktisk koster."
          action={<button className="btn primary" onClick={() => setEditing(newRecipe())}><Plus size={18} /> Ny oppskrift</button>} />
      ) : (
        <div className="cards-grid">
          {data.recipes.map((r) => {
            const res = cost(r)
            return (
              <article key={r.id} className="recipe-card">
                <button className="recipe-main" onClick={() => setViewing(r.id)}>
                  <span className="pill">{t(`bakeType.${r.type}`)}</span>
                  <h3>{r.name}</h3>
                  <p className="muted small">{r.yieldCount} stk · {r.ingredients.length} ingredienser · {r.riseMinutes + r.bakeMinutes} min</p>
                  <div className="recipe-figures">
                    <span><small>Totalt</small><strong>{formatMoney(res.totalCost, f)}</strong></span>
                    <span><small>Per stk</small><strong>{formatMoney(res.costPerItem, f)}</strong></span>
                    {res.savings && <span><small>Spart</small><strong className="pos">{formatMoney(res.savings.perBake, f, 0)}</strong></span>}
                  </div>
                </button>
                <div className="recipe-actions">
                  <button className="icon-btn" aria-label="Beregn" title="Åpne i kalkulator" onClick={() => openInCalculator(r)}><Calculator size={16} /></button>
                  <button className="icon-btn" aria-label="Rediger" title="Rediger" onClick={() => setEditing(structuredClone(r))}><Pencil size={16} /></button>
                  <button className="icon-btn" aria-label="Kopier" title="Kopier" onClick={() => copy(r)}><Copy size={16} /></button>
                  <button className="icon-btn danger" aria-label="Slett" title="Slett" onClick={() => confirm(`Slette «${r.name}»? Historikken beholdes.`) && deleteRecipe(r.id)}><Trash2 size={16} /></button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}
