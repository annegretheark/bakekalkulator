import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Camera, Lock, Receipt, ScanText, X } from 'lucide-react'
import { UNITS, type Ingredient, type Recipe, type Unit } from '../types'
import { useData, useFormat } from '../hooks/useData'
import { useScanAllowed } from '../hooks/useScanAllowed'
import { navigate } from '../hooks/useRoute'
import { defaultEnergyInput } from '../lib/defaults'
import { businessProfile } from '../lib/businessTypes'
import { recognizeText, type OcrProgress } from '../services/scan'
import { matchIngredient, packageUnitFor, parseReceiptText, parseRecipeText } from '../utils/scanParse'
import { formatMoney, toLocalDateKey, uid } from '../utils/format'
import { Card, Notice, NumberField, SelectField, TextField } from './ui'

export function ScanLocked({ loggedIn }: { loggedIn: boolean }) {
  return (
    <Notice>
      <Lock size={14} /> Skanning av oppskrifter, kvitteringer og strekkoder er med i Pro.{' '}
      {loggedIn
        ? <button className="link" onClick={() => navigate('konto')}>Se abonnement</button>
        : <><button className="link" onClick={() => navigate('registrer')}>Opprett konto</button> og prøv Pro gratis i 30 dager.</>}
    </Notice>
  )
}

/** Knapp som åpner kameraet på telefonen (filvelger på PC). */
export function PhotoButton({ label, onFiles, multiple, className = 'btn primary', icon = <Camera size={16} /> }: {
  label: string; onFiles: (files: File[]) => void; multiple?: boolean; className?: string; icon?: ReactNode
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.click()}>{icon} {label}</button>
      <input ref={ref} type="file" accept="image/*" capture="environment" multiple={multiple} hidden aria-label={label}
        onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onFiles(f) }} />
    </>
  )
}

/** Felles flyt: velg bilde → les tekst (med fremdrift) → kontroller. */
function useOcr() {
  const [progress, setProgress] = useState<OcrProgress | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async (files: File[]) => {
    setError(null)
    setProgress({ status: 'Starter …', progress: 0 })
    try {
      setText(await recognizeText(files, setProgress))
    } catch (e) {
      console.error(e)
      setError('Klarte ikke å lese bildet. Sjekk nettforbindelsen (språkdata lastes ned første gang) og prøv igjen.')
    } finally {
      setProgress(null)
    }
  }
  return { progress, text, setText, error, run }
}

function OcrStatus({ progress, error }: { progress: OcrProgress | null; error: string | null }) {
  if (error) return <Notice tone="error">{error}</Notice>
  if (!progress) return null
  return (
    <div className="ocr-progress" role="status">
      <span>{progress.status}</span>
      <progress max={1} value={progress.progress} />
    </div>
  )
}

const TIPS = 'Tips: Legg arket flatt i godt lys, hold telefonen rett over, og få med hele teksten. Bildet leses på telefonen og sendes ikke videre.'

// ---------- Oppskrift ----------

const NEW = '__new'
const SKIP = '__skip'

interface IngredientRow { key: string; line: string; name: string; amount: number; unit: Unit; target: string }

/**
 * Skann en oppskrift: tekstgjenkjenning, tolking og kobling mot ingrediensregisteret.
 * Resultatet åpnes i oppskriftsredigeringen, der brukeren kontrollerer og lagrer.
 */
export function RecipeScanPanel({ onDone, onCancel }: { onDone: (r: Recipe, createdCount: number) => void; onCancel: () => void }) {
  const { data, upsertIngredient } = useData()
  const { allowed, loggedIn } = useScanAllowed()
  const ocr = useOcr()
  const parsed = useMemo(() => (ocr.text === null ? null : parseRecipeText(ocr.text)), [ocr.text])
  const [name, setName] = useState('')
  const [yieldCount, setYieldCount] = useState(1)
  const [rows, setRows] = useState<IngredientRow[]>([])
  const [parsedFor, setParsedFor] = useState<typeof parsed>(null)
  const [busy, setBusy] = useState(false)

  // Fyll skjemaet på nytt når teksten tolkes på nytt
  if (parsed !== parsedFor) {
    setParsedFor(parsed)
    if (parsed) {
      setName(parsed.name)
      setYieldCount(parsed.yieldCount ?? 1)
      setRows(parsed.ingredients.map((p) => ({ key: uid(), line: p.line, name: p.name, amount: p.amount, unit: p.unit, target: matchIngredient(p.name, data.ingredients)?.id ?? NEW })))
    }
  }

  const setRow = (key: string, patch: Partial<IngredientRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const newCount = rows.filter((r) => r.target === NEW).length

  const create = async () => {
    if (!parsed) return
    setBusy(true)
    try {
      const today = toLocalDateKey(new Date())
      const ingredients: Recipe['ingredients'] = []
      let created = 0
      for (const r of rows) {
        if (r.target === SKIP) continue
        let id = r.target
        if (r.target === NEW) {
          const ing: Ingredient = { id: uid(), name: r.name.trim() || 'Ukjent', category: '', packageSize: 1, unit: packageUnitFor(r.unit), price: 0, store: '', priceUpdated: today }
          await upsertIngredient(ing)
          id = ing.id
          created++
        }
        ingredients.push({ id: uid(), ingredientId: id, amount: r.amount, unit: r.unit })
      }
      const now = new Date().toISOString()
      const energy = defaultEnergyInput()
      if (parsed.bakeMinutes) energy.bakeMinutes = parsed.bakeMinutes
      if (parsed.temperatureC) energy.temperatureC = parsed.temperatureC
      onDone({
        id: uid(), name: name.trim(), type: 'brod', yieldCount: Math.max(1, Math.round(yieldCount)), ingredients,
        category: businessProfile(data.settings.businessType).defaultCategory, yieldUnit: businessProfile(data.settings.businessType).defaultYieldUnit,
        prepMinutes: 0, finishedWeightG: null,
        steps: parsed.steps.length ? parsed.steps : [''], riseMinutes: 60, bakeMinutes: energy.bakeMinutes,
        storePricePerItem: 0, notes: 'Skannet fra bilde – kontroller mengder og steg.', energy, createdAt: now, updatedAt: now,
      }, created)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Skann oppskrift" icon={ScanText} actions={<button className="icon-btn" aria-label="Lukk" onClick={onCancel}><X size={18} /></button>}>
      {!allowed ? <ScanLocked loggedIn={loggedIn} /> : ocr.text === null ? (
        <>
          <p className="muted small">Ta bilde av oppskriften fra en kokebok, et ark eller en skjerm. Går den over flere sider, kan du velge flere bilder.</p>
          {!ocr.progress && <div className="actions"><PhotoButton label="Ta bilde / velg bilder" multiple onFiles={ocr.run} /></div>}
          <OcrStatus progress={ocr.progress} error={ocr.error} />
          <p className="muted small">{TIPS}</p>
        </>
      ) : (
        <>
          <div className="form-grid">
            <TextField label="Navn" required value={name} onChange={setName} placeholder="Navn på oppskriften" />
            <NumberField label="Gir antall" value={yieldCount} integer min={1} onChange={setYieldCount} suffix="stk" />
          </div>
          <h3 className="sub-head">Ingredienser ({rows.length})</h3>
          {rows.length === 0 && <Notice tone="warn">Fant ingen ingredienslinjer. Rett teksten under (f.eks. «500 g hvetemel» på egen linje) og trykk «Tolk på nytt».</Notice>}
          {rows.map((r) => (
            <div key={r.key} className="scan-row">
              <TextField label="Fra bildet" value={r.name} onChange={(v) => setRow(r.key, { name: v })} />
              <NumberField label="Mengde" value={r.amount} onChange={(v) => setRow(r.key, { amount: v })} />
              <SelectField<Unit> label="Enhet" value={r.unit} onChange={(v) => setRow(r.key, { unit: v })} options={UNITS.map((u) => ({ value: u, label: u }))} />
              <SelectField label="Ingrediens i registeret" value={r.target} onChange={(v) => setRow(r.key, { target: v })}
                options={[{ value: NEW, label: `+ Ny: ${r.name || '…'}` }, { value: SKIP, label: 'Hopp over' }, ...data.ingredients.map((i) => ({ value: i.id, label: i.name }))]} />
            </div>
          ))}
          {newCount > 0 && <Notice>{newCount} ny(e) ingrediens(er) opprettes uten pris. Legg inn pris under Ingredienser etterpå – eller skann kvitteringen.</Notice>}
          <p className="muted small">{parsed?.steps.length ?? 0} steg i fremgangsmåten{parsed?.bakeMinutes ? ` · steketid ${parsed.bakeMinutes} min` : ''}{parsed?.temperatureC ? ` · ${parsed.temperatureC} °C` : ''}. Du kan rette alt i neste steg.</p>
          <details className="ocr-text">
            <summary>Vis og rett teksten fra bildet</summary>
            <OcrTextEditor key={ocr.text} text={ocr.text} onApply={ocr.setText} />
          </details>
          <div className="actions">
            <button className="btn primary" disabled={busy || !name.trim()} onClick={create}>Lag oppskrift</button>
            <PhotoButton label="Ta nytt bilde" multiple className="btn ghost" onFiles={ocr.run} />
            <button className="btn ghost" onClick={onCancel}>Avbryt</button>
          </div>
          <OcrStatus progress={ocr.progress} error={ocr.error} />
        </>
      )}
    </Card>
  )
}

function OcrTextEditor({ text, onApply }: { text: string; onApply: (t: string) => void }) {
  const [draft, setDraft] = useState(text)
  return (
    <>
      <textarea rows={12} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Tekst fra bildet" />
      <button className="btn ghost" disabled={draft === text} onClick={() => onApply(draft)}>Tolk på nytt</button>
    </>
  )
}

// ---------- Kvittering ----------

interface ReceiptRow { key: string; include: boolean; name: string; price: number; packageSize: number; unit: Unit; target: string }

/** Skann en kvittering og oppdater eller opprett ingredienser med pris. */
export function ReceiptScanPanel({ onClose }: { onClose: (message?: string) => void }) {
  const f = useFormat()
  const { data, upsertIngredient } = useData()
  const { allowed, loggedIn } = useScanAllowed()
  const ocr = useOcr()
  const parsed = useMemo(() => (ocr.text === null ? null : parseReceiptText(ocr.text)), [ocr.text])
  const [store, setStore] = useState('')
  const [rows, setRows] = useState<ReceiptRow[]>([])
  const [parsedFor, setParsedFor] = useState<typeof parsed>(null)
  const [busy, setBusy] = useState(false)

  if (parsed !== parsedFor) {
    setParsedFor(parsed)
    if (parsed) {
      setStore(parsed.store)
      setRows(parsed.lines.map((l) => {
        const match = matchIngredient(l.name, data.ingredients)
        return {
          key: uid(), include: !!match, name: l.name, price: l.price,
          packageSize: l.packageSize ?? match?.packageSize ?? 1,
          unit: l.unit ?? match?.unit ?? 'stk',
          target: match?.id ?? NEW,
        }
      }))
    }
  }

  const setRow = (key: string, patch: Partial<ReceiptRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const chosen = rows.filter((r) => r.include && r.packageSize > 0 && r.price >= 0)

  const save = async () => {
    setBusy(true)
    try {
      const today = toLocalDateKey(new Date())
      let updated = 0
      let created = 0
      for (const r of chosen) {
        const existing = data.ingredients.find((i) => i.id === r.target)
        if (existing) {
          await upsertIngredient({ ...existing, price: r.price, packageSize: r.packageSize, unit: r.unit, store: store || existing.store, priceUpdated: today })
          updated++
        } else {
          await upsertIngredient({ id: uid(), name: r.name.trim(), category: '', packageSize: r.packageSize, unit: r.unit, price: r.price, store, priceUpdated: today })
          created++
        }
      }
      onClose(`${updated} ingrediens(er) oppdatert og ${created} ny(e) lagt til fra kvitteringen.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Skann kvittering" icon={Receipt} actions={<button className="icon-btn" aria-label="Lukk" onClick={() => onClose()}><X size={18} /></button>}>
      {!allowed ? <ScanLocked loggedIn={loggedIn} /> : ocr.text === null ? (
        <>
          <p className="muted small">Ta bilde av kvitteringen. Varer og priser foreslås koblet til ingrediensene dine, og du velger selv hva som skal lagres.</p>
          {!ocr.progress && <div className="actions"><PhotoButton label="Ta bilde av kvittering" onFiles={ocr.run} /></div>}
          <OcrStatus progress={ocr.progress} error={ocr.error} />
          <p className="muted small">{TIPS}</p>
        </>
      ) : (
        <>
          <div className="form-grid"><TextField label="Butikk" value={store} onChange={setStore} /></div>
          {rows.length === 0 && <Notice tone="warn">Fant ingen varelinjer med pris. Prøv et nytt bilde, eller rett teksten under.</Notice>}
          {rows.map((r) => (
            <div key={r.key} className={`scan-row receipt ${r.include ? '' : 'excluded'}`}>
              <label className="check"><input type="checkbox" checked={r.include} onChange={(e) => setRow(r.key, { include: e.target.checked })} aria-label={`Ta med ${r.name}`} /></label>
              <TextField label="Vare" value={r.name} onChange={(v) => setRow(r.key, { name: v })} />
              <NumberField label="Pris" value={r.price} onChange={(v) => setRow(r.key, { price: v })} suffix="kr" />
              <NumberField label="Pakning" value={r.packageSize} min={0.001} onChange={(v) => setRow(r.key, { packageSize: v })} />
              <SelectField<Unit> label="Enhet" value={r.unit} onChange={(v) => setRow(r.key, { unit: v })} options={UNITS.map((u) => ({ value: u, label: u }))} />
              <SelectField label="Lagre som" value={r.target} onChange={(v) => setRow(r.key, { target: v, include: true })}
                options={[{ value: NEW, label: `+ Ny ingrediens` }, ...data.ingredients.map((i) => ({ value: i.id, label: `Oppdater: ${i.name}` }))]} />
            </div>
          ))}
          <p className="muted small">Varer som ikke er bakeingredienser er ikke krysset av. Sjekk pakningsstørrelsen – den står ikke alltid på kvitteringen.</p>
          <details className="ocr-text">
            <summary>Vis og rett teksten fra bildet</summary>
            <OcrTextEditor key={ocr.text} text={ocr.text} onApply={ocr.setText} />
          </details>
          <div className="actions">
            <button className="btn primary" disabled={busy || chosen.length === 0} onClick={save}>
              Lagre {chosen.length} {chosen.length === 1 ? 'vare' : 'varer'} ({formatMoney(chosen.reduce((s, r) => s + r.price, 0), f)})
            </button>
            <PhotoButton label="Ta nytt bilde" className="btn ghost" onFiles={ocr.run} />
            <button className="btn ghost" onClick={() => onClose()}>Avbryt</button>
          </div>
          <OcrStatus progress={ocr.progress} error={ocr.error} />
        </>
      )}
    </Card>
  )
}
