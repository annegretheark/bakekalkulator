import { useMemo, useState } from 'react'
import { Barcode, Pencil, Plus, Receipt, Search, ShoppingBasket, Trash2 } from 'lucide-react'
import { UNITS, type Ingredient, type Unit } from '../types'
import { useData, useFormat } from '../hooks/useData'
import { Card, EmptyState, Notice, NumberField, PageHeader, SelectField, TextField } from '../components/ui'
import { formatDate, formatMoney, formatNumber, toLocalDateKey } from '../utils/format'
import { unitDimension } from '../utils/units'
import { IngredientScanPanel, ReceiptScanPanel } from '../components/ScanPanels'
import { blankIngredient as blank, takeIngredient } from '../lib/scanHandoff'
import { AllergenEditor, AllergenSummary } from '../components/Allergens'
import { IngredientPrices } from '../components/IngredientPrices'


/** Pris per basisenhet for sammenligning (kr/kg, kr/l, kr/stk). */
function unitPrice(i: Ingredient): string {
  const dim = unitDimension(i.unit)
  const factor = { g: 1000, kg: 1, ml: 1000, dl: 10, l: 1, stk: 1 }[i.unit]
  const per = i.packageSize > 0 ? (i.price / i.packageSize) * factor : NaN
  return `${formatNumber(per, 2)} kr/${dim === 'mass' ? 'kg' : dim === 'volume' ? 'l' : 'stk'}`
}

export function IngredientsPage() {
  const f = useFormat()
  const { data, upsertIngredient, deleteIngredient } = useData()
  // Utkast fra «Skann»-siden åpnes direkte i skjemaet
  const [handoff] = useState(() => takeIngredient())
  const [editing, setEditing] = useState<Ingredient | null>(handoff?.draft ?? null)
  const [query, setQuery] = useState('')
  const [receipt, setReceipt] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [info, setInfo] = useState<{ tone: 'info' | 'warn' | 'error'; text: string } | null>(handoff ? { tone: 'info', text: handoff.message } : null)

  const usedIn = useMemo(() => {
    const m = new Map<string, number>()
    data.recipes.forEach((r) => r.ingredients.forEach((ri) => { if (!ri.subRecipeId) m.set(ri.ingredientId, (m.get(ri.ingredientId) ?? 0) + 1) }))
    return m
  }, [data.recipes])

  const list = data.ingredients
    .filter((i) => `${i.name} ${i.category} ${i.store}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.category.localeCompare(b.category, 'nb') || a.name.localeCompare(b.name, 'nb'))

  const categories = [...new Set(data.ingredients.map((i) => i.category).filter(Boolean))]
  const valid = editing && editing.name.trim() && editing.packageSize > 0 && editing.price >= 0

  const save = async () => {
    if (!editing || !valid) return
    const prev = data.ingredients.find((i) => i.id === editing.id)
    const priceChanged = !prev || prev.price !== editing.price || prev.packageSize !== editing.packageSize
    await upsertIngredient({ ...editing, name: editing.name.trim(), priceUpdated: priceChanged ? toLocalDateKey(new Date()) : editing.priceUpdated })
    setEditing(null)
    setInfo(null)
  }

  const remove = (i: Ingredient) => {
    const n = usedIn.get(i.id) ?? 0
    if (confirm(n ? `${i.name} brukes i ${n} oppskrift(er). Slette likevel?` : `Slette ${i.name}?`)) deleteIngredient(i.id)
  }

  return (
    <>
      <PageHeader title="Ingredienser" description="Registrer innkjøpspriser. Kostnaden i oppskriftene beregnes automatisk ut fra mengden du bruker."
        actions={<>
          <button className="btn ghost" onClick={() => { setReceipt(true); setScanning(false); setInfo(null) }}><Receipt size={18} /> Skann kvittering</button>
          <button className="btn ghost" onClick={() => { setScanning(true); setReceipt(false); setInfo(null) }}><Barcode size={18} /> Skann ingrediens</button>
          <button className="btn primary" onClick={() => setEditing(blank())}><Plus size={18} /> Ny ingrediens</button>
        </>} />

      {scanning && <IngredientScanPanel onCancel={() => setScanning(false)} onDone={(draft, message) => { setScanning(false); setEditing(draft); setInfo({ tone: 'info', text: message }) }} />}
      {info && <Notice tone={info.tone}>{info.text}</Notice>}
      {receipt && <ReceiptScanPanel onClose={(msg) => { setReceipt(false); if (msg) setInfo({ tone: 'info', text: msg }) }} />}

      {editing && (
        <Card title={data.ingredients.some((i) => i.id === editing.id) ? 'Rediger ingrediens' : 'Ny ingrediens'} icon={ShoppingBasket}>
          <div className="form-grid">
            <TextField label="Navn" required value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} placeholder="F.eks. Hvetemel" />
            <div className="field">
              <label htmlFor="cat">Kategori</label>
              <input id="cat" list="cats" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} placeholder="F.eks. Mel" />
              <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <NumberField label="Pakningsstørrelse" value={editing.packageSize} min={0.001} onChange={(v) => setEditing({ ...editing, packageSize: v })} />
            <SelectField<Unit> label="Måleenhet" value={editing.unit} onChange={(v) => setEditing({ ...editing, unit: v })} options={UNITS.map((u) => ({ value: u, label: u }))} />
            <NumberField label="Innkjøpspris" value={editing.price} onChange={(v) => setEditing({ ...editing, price: v })} suffix="kr" />
            <TextField label="Butikk" value={editing.store} onChange={(v) => setEditing({ ...editing, store: v })} />
            <TextField label="Pris sist oppdatert" type="date" value={editing.priceUpdated} onChange={(v) => setEditing({ ...editing, priceUpdated: v })} />
            <SelectField label="Leverandør" value={editing.supplierId ?? ''} onChange={(v) => {
              const sup = data.suppliers.find((x) => x.id === v)
              setEditing({ ...editing, supplierId: v || null, store: sup ? sup.name : editing.store })
            }} options={[{ value: '', label: data.suppliers.length ? '— Ingen —' : '— Legg inn under Leverandører —' }, ...data.suppliers.map((x) => ({ value: x.id, label: x.name }))]} />
            <TextField label="Leverandørens varenummer" value={editing.supplierItemNo} onChange={(v) => setEditing({ ...editing, supplierItemNo: v })} />
            <TextField label="Produsent" value={editing.manufacturer} onChange={(v) => setEditing({ ...editing, manufacturer: v })} />
            <TextField label="Strekkode (EAN/GTIN)" value={editing.ean} onChange={(v) => setEditing({ ...editing, ean: v.replace(/\D/g, '').slice(0, 14) })} placeholder="8–14 siffer" />
            <NumberField label="Mva" value={editing.vatPercent} max={100} onChange={(v) => setEditing({ ...editing, vatPercent: v })} suffix="%" hint="15 % for næringsmidler" />
            <NumberField label="Råvaresvinn" value={editing.wastePercent} max={94} onChange={(v) => setEditing({ ...editing, wastePercent: v })} suffix="%" hint="Skrell, ben, avskjær. Øker kostnaden i oppskriftene." />
            <NumberField label="Minimumsbeholdning" value={editing.minStock ?? 0} max={100000000} onChange={(v) => setEditing({ ...editing, minStock: v > 0 ? v : null })} suffix={editing.unit} hint="Varsel på lagersiden. 0 = ingen" />
            <TextField label="Kommentar" value={editing.comment} onChange={(v) => setEditing({ ...editing, comment: v })} />
          </div>
          <AllergenEditor value={editing.allergens} onChange={(v) => setEditing({ ...editing, allergens: v })} />
          {editing.ean && !/^\d{8,14}$/.test(editing.ean) && <Notice tone="warn">Strekkoden må ha 8–14 siffer. Den lagres ikke ellers.</Notice>}
          <IngredientPrices ingredient={editing} onUse={(patch) => setEditing({ ...editing, ...patch })} />
          {!editing.allergensChecked && (
            <Notice tone="warn">
              Allergenene er foreslått automatisk og ikke kontrollert. Sjekk dem mot varedeklarasjonen.{' '}
              <button type="button" className="btn ghost small" onClick={() => setEditing({ ...editing, allergensChecked: true })}>Jeg har kontrollert allergenene</button>
            </Notice>
          )}
          <Notice>Vekt og volum regnes ikke om til hverandre. Registrer ingrediensen i samme type enhet som du bruker i oppskriften (f.eks. mel i kg/g, melk i l/dl).</Notice>
          <div className="actions">
            <button className="btn primary" disabled={!valid} onClick={save}>Lagre</button>
            <button className="btn ghost" onClick={() => { setEditing(null); setInfo(null) }}>Avbryt</button>
          </div>
        </Card>
      )}

      {data.ingredients.length === 0 ? (
        <EmptyState icon={ShoppingBasket} title="Ingen ingredienser ennå" text="Legg inn mel, gjær, salt og annet du baker med, så beregner vi kostnaden per oppskrift."
          action={<button className="btn primary" onClick={() => setEditing(blank())}><Plus size={18} /> Legg til første ingrediens</button>} />
      ) : (
        <Card>
          <div className="search"><Search size={16} aria-hidden /><input aria-label="Søk" placeholder="Søk i ingredienser …" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          <div className="table-wrap">
            <table className="clean responsive">
              <thead><tr><th>Navn</th><th>Kategori</th><th className="num">Pakning</th><th className="num">Pris</th><th className="num">Enhetspris</th><th>Allergener</th><th>Leverandør</th><th>Oppdatert</th><th /></tr></thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id}>
                    <td data-label="Navn"><strong>{i.name}</strong></td>
                    <td data-label="Kategori">{i.category || <span className="muted">–</span>}</td>
                    <td data-label="Pakning" className="num">{formatNumber(i.packageSize, 3, f.locale)} {i.unit}</td>
                    <td data-label="Pris" className="num">{formatMoney(i.price, f)}</td>
                    <td data-label="Enhetspris" className="num muted">{unitPrice(i)}</td>
                    <td data-label="Allergener"><AllergenSummary map={i.allergens} />{!i.allergensChecked && <span className="tag allergen-ukjent">Ikke kontrollert</span>}</td>
                    <td data-label="Butikk">{data.suppliers.find((x) => x.id === i.supplierId)?.name ?? i.store}{i.wastePercent > 0 && <small className="muted block">Svinn {i.wastePercent} %</small>}</td>
                    <td data-label="Oppdatert">{i.priceUpdated ? formatDate(i.priceUpdated, f.locale) : '–'}</td>
                    <td className="row-actions">
                      <button className="icon-btn" aria-label={`Rediger ${i.name}`} onClick={() => setEditing(i)}><Pencil size={16} /></button>
                      <button className="icon-btn danger" aria-label={`Slett ${i.name}`} onClick={() => remove(i)}><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.length === 0 && <p className="muted">Ingen treff på «{query}».</p>}
        </Card>
      )}
    </>
  )
}
