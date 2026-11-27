import { useMemo, useState } from 'react'
import { Barcode, Pencil, Plus, Receipt, Search, ShoppingBasket, Trash2 } from 'lucide-react'
import { UNITS, type Ingredient, type Unit } from '../types'
import { useData, useFormat } from '../hooks/useData'
import { Card, EmptyState, Notice, NumberField, PageHeader, SelectField, TextField } from '../components/ui'
import { formatDate, formatMoney, formatNumber, toLocalDateKey, uid } from '../utils/format'
import { unitDimension } from '../utils/units'
import { PhotoButton, ReceiptScanPanel, ScanLocked } from '../components/ScanPanels'
import { useScanAllowed } from '../hooks/useScanAllowed'
import { decodeBarcode, lookupProduct } from '../services/scan'

const blank = (): Ingredient => ({ id: uid(), name: '', category: '', packageSize: 1, unit: 'kg', price: 0, store: '', priceUpdated: toLocalDateKey(new Date()) })

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
  const [editing, setEditing] = useState<Ingredient | null>(null)
  const [query, setQuery] = useState('')
  const [receipt, setReceipt] = useState(false)
  const [info, setInfo] = useState<{ tone: 'info' | 'warn' | 'error'; text: string } | null>(null)
  const [barcodeBusy, setBarcodeBusy] = useState(false)
  const [showLocked, setShowLocked] = useState(false)
  const scan = useScanAllowed()

  const scanBarcode = async (files: File[]) => {
    setInfo(null)
    setBarcodeBusy(true)
    try {
      const ean = await decodeBarcode(files[0])
      if (!ean) { setInfo({ tone: 'warn', text: 'Fant ingen strekkode i bildet. Ta bildet nærmere og rett på strekkoden.' }); return }
      const product = await lookupProduct(ean).catch(() => null)
      if (!product) {
        setEditing(blank())
        setInfo({ tone: 'warn', text: `Strekkode ${ean} ble ikke funnet i varedatabasen. Fyll inn varen selv.` })
        return
      }
      const withBrand = product.brand && !product.name.toLowerCase().includes(product.brand.toLowerCase()) ? `${product.name} (${product.brand})` : product.name
      setEditing({ ...blank(), name: withBrand, packageSize: product.packageSize ?? 1, unit: product.unit ?? 'stk', category: product.category })
      setInfo({ tone: 'info', text: `Fant «${product.name}». Kontroller pakningsstørrelsen og legg inn prisen du betalte.` })
    } catch (e) {
      console.error(e)
      setInfo({ tone: 'error', text: 'Klarte ikke å lese strekkoden. Prøv igjen.' })
    } finally {
      setBarcodeBusy(false)
    }
  }

  const usedIn = useMemo(() => {
    const m = new Map<string, number>()
    data.recipes.forEach((r) => r.ingredients.forEach((ri) => m.set(ri.ingredientId, (m.get(ri.ingredientId) ?? 0) + 1)))
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
          <button className="btn ghost" onClick={() => { setReceipt(true); setInfo(null) }}><Receipt size={18} /> Skann kvittering</button>
          {scan.allowed
            ? <PhotoButton label={barcodeBusy ? 'Leser strekkode …' : 'Skann strekkode'} className="btn ghost" icon={<Barcode size={18} />} onFiles={scanBarcode} />
            : <button className="btn ghost" onClick={() => setShowLocked(true)}><Barcode size={18} /> Skann strekkode</button>}
          <button className="btn primary" onClick={() => setEditing(blank())}><Plus size={18} /> Ny ingrediens</button>
        </>} />

      {showLocked && !scan.allowed && <ScanLocked loggedIn={scan.loggedIn} />}
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
          </div>
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
              <thead><tr><th>Navn</th><th>Kategori</th><th className="num">Pakning</th><th className="num">Pris</th><th className="num">Enhetspris</th><th>Butikk</th><th>Oppdatert</th><th /></tr></thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id}>
                    <td data-label="Navn"><strong>{i.name}</strong></td>
                    <td data-label="Kategori">{i.category || <span className="muted">–</span>}</td>
                    <td data-label="Pakning" className="num">{formatNumber(i.packageSize, 3, f.locale)} {i.unit}</td>
                    <td data-label="Pris" className="num">{formatMoney(i.price, f)}</td>
                    <td data-label="Enhetspris" className="num muted">{unitPrice(i)}</td>
                    <td data-label="Butikk">{i.store}</td>
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
