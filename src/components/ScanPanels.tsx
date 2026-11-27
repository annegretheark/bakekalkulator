import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Barcode, Camera, ImageUp, Lock, Package, Receipt, ScanText, Sparkles, X } from 'lucide-react'
import { UNITS, type Ingredient, type Recipe, type Unit } from '../types'
import { useData, useFormat } from '../hooks/useData'
import { useScanAllowed } from '../hooks/useScanAllowed'
import { useAiScan } from '../hooks/useAiScan'
import { navigate } from '../hooks/useRoute'
import { defaultEnergyInput } from '../lib/defaults'
import { businessProfile } from '../lib/businessTypes'
import { decodeBarcode, lookupProduct, ProductLookupError, recognizeText, type OcrProgress } from '../services/scan'
import { matchIngredient, packageUnitFor, parseReceiptText, parseRecipeText, type ParsedReceipt, type ParsedRecipe } from '../utils/scanParse'
import { ingredientFromAi, receiptFromAi, recipeFromAi, type AiParsedRecipe } from '../utils/aiMapping'
import { formatDate, formatMoney, toLocalDateKey, uid } from '../utils/format'
import { blankIngredient } from '../lib/scanHandoff'
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

/** Knapp som åpner kameraet på telefonen (filvelger på PC). `capture: false` åpner bildegalleriet. */
export function PhotoButton({ label, onFiles, multiple, className = 'btn primary', icon = <Camera size={16} />, capture = true, disabled }: {
  label: string; onFiles: (files: File[]) => void; multiple?: boolean; className?: string; icon?: ReactNode; capture?: boolean; disabled?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => ref.current?.click()}>{icon} {label}</button>
      <input ref={ref} type="file" accept="image/*" capture={capture ? 'environment' : undefined} multiple={multiple} hidden aria-label={label}
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

const TIPS = 'Tips: Legg arket flatt i godt lys, hold telefonen rett over, og få med hele teksten.'

type Ai = ReturnType<typeof useAiScan>

/** Kvote for AI-tolkning, vist ved knappen. */
function AiQuota({ ai }: { ai: Ai }) {
  if (!ai.active) return null
  const left = Math.max(0, ai.status.limit - ai.status.used)
  return (
    <p className="muted small">
      <Sparkles size={13} aria-hidden /> AI-tolkning: {ai.status.used} av {ai.status.limit} brukt denne måneden
      {left === 0 && ai.status.resetsAt ? ` – nye skanninger fra ${formatDate(ai.status.resetsAt)}` : ''}.
    </p>
  )
}

/**
 * Valg av lesemåte: tekstgjenkjenning på telefonen (Pro, gratis i bruk, bildet
 * forlater ikke telefonen) eller AI-tolkning (bedre på håndskrift og fakturaer,
 * teller mot månedskvoten, bildet sendes kryptert til AI-tjenesten og lagres ikke).
 */
function ReadChoice({ ocrAllowed, ai, onOcr, onAi, multiple, upload, ocrLabel, aiLabel, disabled }: {
  ocrAllowed: boolean; ai: Ai; onOcr: (f: File[]) => void; onAi: (f: File) => void; multiple?: boolean; upload?: boolean
  ocrLabel: string; aiLabel: string; disabled?: boolean
}) {
  const icon = upload ? <ImageUp size={16} /> : <Camera size={16} />
  return (
    <>
      <div className="actions">
        {ocrAllowed && <PhotoButton label={ocrLabel} multiple={multiple} capture={!upload} icon={icon} onFiles={onOcr} disabled={disabled}
          className={ai.available ? 'btn ghost' : 'btn primary'} />}
        {ai.available && <PhotoButton label={aiLabel} capture={!upload} icon={<Sparkles size={16} />} onFiles={(f) => onAi(f[0])} disabled={disabled} />}
      </div>
      <AiQuota ai={ai} />
      {ai.available
        ? <p className="muted small">«{ocrLabel}» leser teksten på telefonen, og bildet sendes ikke videre. «{aiLabel}» er bedre på håndskrift og fakturaer. Da sendes bildet til AI-tjenesten for tolkning og lagres ikke.</p>
        : <p className="muted small">Bildet leses på telefonen og sendes ikke videre.</p>}
    </>
  )
}

// ---------- Oppskrift ----------

const NEW = '__new'
const SKIP = '__skip'

interface IngredientRow { key: string; line: string; name: string; amount: number; unit: Unit; target: string }

/**
 * Skann en oppskrift: tekstgjenkjenning eller AI, tolking og kobling mot ingrediensregisteret.
 * Resultatet åpnes i oppskriftsredigeringen, der brukeren kontrollerer og lagrer.
 */
export function RecipeScanPanel({ onDone, onCancel, upload }: { onDone: (r: Recipe, createdCount: number) => void; onCancel: () => void; upload?: boolean }) {
  const { data, upsertIngredient } = useData()
  const { allowed, loggedIn } = useScanAllowed()
  const ai = useAiScan()
  const ocr = useOcr()
  const ocrParsed = useMemo(() => (ocr.text === null ? null : parseRecipeText(ocr.text)), [ocr.text])
  const [aiParsed, setAiParsed] = useState<AiParsedRecipe | null>(null)
  const parsed: ParsedRecipe | AiParsedRecipe | null = aiParsed ?? ocrParsed
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

  const runOcr = (files: File[]) => { setAiParsed(null); return ocr.run(files) }
  const runAi = async (file: File) => {
    const res = await ai.run('oppskrift', file)
    if (res?.kind === 'oppskrift') { ocr.setText(null); setAiParsed(recipeFromAi(res.recipe)) }
  }

  const setRow = (key: string, patch: Partial<IngredientRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const newCount = rows.filter((r) => r.target === NEW).length
  const profile = businessProfile(data.settings.businessType)

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
          const ing: Ingredient = { id: uid(), name: r.name.trim() || 'Ukjent', category: '', packageSize: 1, unit: packageUnitFor(r.unit), price: 0, store: '', priceUpdated: today, allergens: {}, allergensChecked: true }
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
      const extra = aiParsed
      onDone({
        id: uid(), name: name.trim(), type: 'brod', yieldCount: Math.max(1, Math.round(yieldCount)), ingredients,
        category: profile.defaultCategory, yieldUnit: extra?.yieldUnit ?? profile.defaultYieldUnit,
        prepMinutes: extra?.prepMinutes ?? 0, finishedWeightG: null, labor: [], packagingPerUnit: 0, crossContact: [],
        steps: parsed.steps.length ? parsed.steps : [''], riseMinutes: profile.defaultCategory === 'brod_bakervarer' ? 60 : 0, bakeMinutes: energy.bakeMinutes,
        storePricePerItem: 0, notes: `Skannet fra bilde${aiParsed ? ' med AI' : ''} – kontroller mengder og steg.`, energy, createdAt: now, updatedAt: now,
      }, created)
    } finally {
      setBusy(false)
    }
  }

  const canStart = allowed || ai.available
  return (
    <Card title="Skann oppskrift" icon={ScanText} actions={<button className="icon-btn" aria-label="Lukk" onClick={onCancel}><X size={18} /></button>}>
      {!canStart && !parsed ? <ScanLocked loggedIn={loggedIn} /> : parsed === null ? (
        <>
          <p className="muted small">Ta bilde av oppskriften fra en kokebok, et ark eller en skjerm. Med tekstgjenkjenning kan du velge flere bilder hvis den går over flere sider.</p>
          {!ocr.progress && !ai.busy && (
            <ReadChoice ocrAllowed={allowed} ai={ai} onOcr={runOcr} onAi={runAi} multiple upload={upload}
              ocrLabel={upload ? 'Velg bilder' : 'Ta bilde / velg bilder'} aiLabel="Tolk med AI" />
          )}
          {ai.busy && <p className="muted" role="status">Tolker oppskriften med AI …</p>}
          {ai.error && <Notice tone="error">{ai.error}</Notice>}
          <OcrStatus progress={ocr.progress} error={ocr.error} />
          <p className="muted small">{TIPS}</p>
        </>
      ) : (
        <>
          {aiParsed && <Notice>Tolket med AI. Kontroller navn, mengder og enheter før du lager oppskriften.</Notice>}
          <div className="form-grid">
            <TextField label="Navn" required value={name} onChange={setName} placeholder="Navn på oppskriften" />
            <NumberField label="Gir antall" value={yieldCount} integer min={1} onChange={setYieldCount}
              suffix={aiParsed?.yieldUnit === 'porsjoner' ? 'porsjoner' : profile.defaultYieldUnit} />
          </div>
          <h3 className="sub-head">Ingredienser ({rows.length})</h3>
          {rows.length === 0 && <Notice tone="warn">Fant ingen ingredienslinjer. {ocr.text !== null ? 'Rett teksten under (f.eks. «500 g hvetemel» på egen linje) og trykk «Tolk på nytt».' : 'Prøv et nytt bilde.'}</Notice>}
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
          <p className="muted small">
            {parsed.steps.length} steg i fremgangsmåten
            {aiParsed?.prepMinutes ? ` · tilberedning ${aiParsed.prepMinutes} min` : ''}
            {parsed.bakeMinutes ? ` · steke-/koketid ${parsed.bakeMinutes} min` : ''}
            {parsed.temperatureC ? ` · ${parsed.temperatureC} °C` : ''}. Du kan rette alt i neste steg.
          </p>
          {ocr.text !== null && (
            <details className="ocr-text">
              <summary>Vis og rett teksten fra bildet</summary>
              <OcrTextEditor key={ocr.text} text={ocr.text} onApply={ocr.setText} />
            </details>
          )}
          <div className="actions">
            <button className="btn primary" disabled={busy || !name.trim()} onClick={create}>Lag oppskrift</button>
            <button className="btn ghost" onClick={() => { setAiParsed(null); ocr.setText(null) }}>Nytt bilde</button>
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

// ---------- Kvittering og faktura ----------

interface ReceiptRow { key: string; include: boolean; name: string; line: string; price: number; packageSize: number; unit: Unit; target: string }

/**
 * Skann en kvittering eller leverandørfaktura. Brukeren godkjenner hver prisendring
 * (krysser av) før noe lagres; nåværende pris vises ved siden av den nye.
 */
export function ReceiptScanPanel({ onClose, upload }: { onClose: (message?: string) => void; upload?: boolean }) {
  const f = useFormat()
  const { data, upsertIngredient } = useData()
  const { allowed, loggedIn } = useScanAllowed()
  const ai = useAiScan()
  const ocr = useOcr()
  const ocrParsed = useMemo(() => (ocr.text === null ? null : parseReceiptText(ocr.text)), [ocr.text])
  const [aiParsed, setAiParsed] = useState<(ParsedReceipt & { date: string | null }) | null>(null)
  const parsed: ParsedReceipt | null = aiParsed ?? ocrParsed
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
          key: uid(), include: !!match, name: l.name, line: l.line, price: l.price,
          packageSize: l.packageSize ?? match?.packageSize ?? 1,
          unit: l.unit ?? match?.unit ?? 'stk',
          target: match?.id ?? NEW,
        }
      }))
    }
  }

  const runOcr = (files: File[]) => { setAiParsed(null); return ocr.run(files) }
  const runAi = async (file: File) => {
    const res = await ai.run('kvittering', file)
    if (res?.kind === 'kvittering') { ocr.setText(null); setAiParsed(receiptFromAi(res.receipt)) }
  }

  const setRow = (key: string, patch: Partial<ReceiptRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const chosen = rows.filter((r) => r.include && r.packageSize > 0 && r.price >= 0)
  const priceDate = aiParsed?.date ?? toLocalDateKey(new Date())

  const save = async () => {
    setBusy(true)
    try {
      let updated = 0
      let created = 0
      for (const r of chosen) {
        const existing = data.ingredients.find((i) => i.id === r.target)
        if (existing) {
          await upsertIngredient({ ...existing, price: r.price, packageSize: r.packageSize, unit: r.unit, store: store || existing.store, priceUpdated: priceDate })
          updated++
        } else {
          await upsertIngredient({ id: uid(), name: r.name.trim(), category: '', packageSize: r.packageSize, unit: r.unit, price: r.price, store, priceUpdated: priceDate, allergens: {}, allergensChecked: true })
          created++
        }
      }
      onClose(`${updated} ingrediens(er) oppdatert og ${created} ny(e) lagt til fra kvitteringen.`)
    } finally {
      setBusy(false)
    }
  }

  const canStart = allowed || ai.available
  return (
    <Card title="Skann kvittering eller faktura" icon={Receipt} actions={<button className="icon-btn" aria-label="Lukk" onClick={() => onClose()}><X size={18} /></button>}>
      {!canStart && !parsed ? <ScanLocked loggedIn={loggedIn} /> : parsed === null ? (
        <>
          <p className="muted small">Ta bilde av kvitteringen eller leverandørfakturaen. Varer og priser foreslås koblet til ingrediensene dine, og du godkjenner selv hver prisendring.</p>
          {!ocr.progress && !ai.busy && (
            <ReadChoice ocrAllowed={allowed} ai={ai} onOcr={runOcr} onAi={runAi} upload={upload}
              ocrLabel={upload ? 'Velg bilde' : 'Ta bilde'} aiLabel="Tolk med AI" />
          )}
          {ai.busy && <p className="muted" role="status">Tolker kvitteringen med AI …</p>}
          {ai.error && <Notice tone="error">{ai.error}</Notice>}
          <OcrStatus progress={ocr.progress} error={ocr.error} />
          <p className="muted small">{TIPS}</p>
        </>
      ) : (
        <>
          {aiParsed && <Notice>Tolket med AI. Kontroller varer, pakningsstørrelse og pris før du lagrer.</Notice>}
          <div className="form-grid">
            <TextField label="Butikk / leverandør" value={store} onChange={setStore} />
            {aiParsed?.date && <TextField label="Dato på kvitteringen" value={formatDate(aiParsed.date)} onChange={() => {}} />}
          </div>
          {rows.length === 0 && <Notice tone="warn">Fant ingen varelinjer med pris. Prøv et nytt bilde{ocr.text !== null ? ', eller rett teksten under' : ''}.</Notice>}
          {rows.map((r) => {
            const existing = data.ingredients.find((i) => i.id === r.target)
            const changed = existing && (existing.price !== r.price || existing.packageSize !== r.packageSize || existing.unit !== r.unit)
            return (
              <div key={r.key} className={`scan-row receipt ${r.include ? '' : 'excluded'}`}>
                <label className="check"><input type="checkbox" checked={r.include} onChange={(e) => setRow(r.key, { include: e.target.checked })} aria-label={`Ta med ${r.name}`} /></label>
                <TextField label="Vare" value={r.name} onChange={(v) => setRow(r.key, { name: v })} />
                <NumberField label="Pris per pakning" value={r.price} onChange={(v) => setRow(r.key, { price: v })} suffix="kr" />
                <NumberField label="Pakning" value={r.packageSize} min={0.001} onChange={(v) => setRow(r.key, { packageSize: v })} />
                <SelectField<Unit> label="Enhet" value={r.unit} onChange={(v) => setRow(r.key, { unit: v })} options={UNITS.map((u) => ({ value: u, label: u }))} />
                <SelectField label="Lagre som" value={r.target} onChange={(v) => setRow(r.key, { target: v, include: true })}
                  options={[{ value: NEW, label: `+ Ny ingrediens` }, ...data.ingredients.map((i) => ({ value: i.id, label: `Oppdater: ${i.name}` }))]} />
                {(existing || r.line !== r.name) && (
                  <small className="muted full">
                    {r.line !== r.name ? `Fra bildet: ${r.line}` : ''}
                    {existing && changed ? `${r.line !== r.name ? ' · ' : ''}Nå: ${formatMoney(existing.price, f)} for ${existing.packageSize} ${existing.unit}` : ''}
                    {existing && !changed ? `${r.line !== r.name ? ' · ' : ''}Samme pris som før` : ''}
                  </small>
                )}
              </div>
            )
          })}
          <p className="muted small">Varer som ikke passer en ingrediens, er ikke krysset av. Sjekk pakningsstørrelsen – den står ikke alltid på kvitteringen. Kostnader i historikken endres ikke.</p>
          {ocr.text !== null && (
            <details className="ocr-text">
              <summary>Vis og rett teksten fra bildet</summary>
              <OcrTextEditor key={ocr.text} text={ocr.text} onApply={ocr.setText} />
            </details>
          )}
          <div className="actions">
            <button className="btn primary" disabled={busy || chosen.length === 0} onClick={save}>
              Godkjenn og lagre {chosen.length} {chosen.length === 1 ? 'vare' : 'varer'}
            </button>
            <button className="btn ghost" onClick={() => { setAiParsed(null); ocr.setText(null) }}>Nytt bilde</button>
            <button className="btn ghost" onClick={() => onClose()}>Avbryt</button>
          </div>
          <OcrStatus progress={ocr.progress} error={ocr.error} />
        </>
      )}
    </Card>
  )
}

// ---------- Ingrediens (strekkode eller etikett) ----------

/**
 * Skann en ingrediens: strekkode (oppslag i Open Food Facts, belaster ikke AI-kvoten)
 * eller bilde av etiketten med AI. Resultatet åpnes i ingrediensskjemaet, der
 * brukeren legger inn pris og kontrollerer allergenene. Manuell registrering virker alltid.
 */
export function IngredientScanPanel({ onDone, onCancel, upload }: { onDone: (draft: Ingredient, message: string) => void; onCancel: () => void; upload?: boolean }) {
  const { allowed, loggedIn } = useScanAllowed()
  const ai = useAiScan()
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<{ tone: 'info' | 'warn' | 'error'; text: string } | null>(null)

  const scanBarcode = async (files: File[]) => {
    setInfo(null)
    setBusy(true)
    try {
      const ean = await decodeBarcode(files[0])
      if (!ean) { setInfo({ tone: 'warn', text: 'Fant ingen strekkode i bildet. Ta bildet nærmere og rett på strekkoden – eller ta bilde av etiketten.' }); return }
      let product
      try {
        product = await lookupProduct(ean)
      } catch (e) {
        if (e instanceof ProductLookupError) { onDone(blankIngredient(), `${e.message} Strekkode ${ean}.`); return }
        throw e
      }
      if (!product) { onDone(blankIngredient(), `Strekkode ${ean} finnes ikke i varedatabasen. Fyll inn varen selv.`); return }
      const withBrand = product.brand && !product.name.toLowerCase().includes(product.brand.toLowerCase()) ? `${product.name} (${product.brand})` : product.name
      const hasAllergens = Object.keys(product.allergens).length > 0
      onDone(
        { ...blankIngredient(), name: withBrand, packageSize: product.packageSize ?? 1, unit: product.unit ?? 'stk', category: product.category, allergens: product.allergens, allergensChecked: !hasAllergens },
        `Fant «${product.name}» i Open Food Facts. Kontroller pakningsstørrelsen, legg inn prisen du betalte${hasAllergens ? ' og kontroller allergenene mot pakningen' : ''}.`,
      )
    } catch (e) {
      console.error(e)
      setInfo({ tone: 'error', text: 'Klarte ikke å lese strekkoden. Prøv igjen, eller fyll inn varen selv.' })
    } finally {
      setBusy(false)
    }
  }

  const scanLabel = async (file: File) => {
    const res = await ai.run('ingrediens', file)
    if (res?.kind === 'ingrediens') {
      onDone(ingredientFromAi(res.ingredient, blankIngredient()),
        'Tolket fra etiketten med AI. Kontroller navn og pakning, legg inn prisen og kontroller allergenene mot pakningen. Allergener som ikke er nevnt på etiketten, står som ukjente.')
    }
  }

  return (
    <Card title="Skann ingrediens" icon={Package} actions={<button className="icon-btn" aria-label="Lukk" onClick={onCancel}><X size={18} /></button>}>
      {!allowed && !ai.available ? <ScanLocked loggedIn={loggedIn} /> : (
        <>
          <p className="muted small">
            Ta bilde av strekkoden for å slå opp varen{ai.available ? ', eller av etiketten med ingrediensliste for å tolke den med AI' : ''}.
            Prisen står ikke i strekkoden – den legger du inn selv.
          </p>
          <div className="actions">
            {allowed && <PhotoButton label={busy ? 'Leser strekkode …' : upload ? 'Velg bilde av strekkode' : 'Skann strekkode'} icon={<Barcode size={16} />} capture={!upload} onFiles={scanBarcode} disabled={busy || ai.busy} />}
            {ai.available && <PhotoButton label={ai.busy ? 'Tolker …' : 'Tolk etiketten med AI'} className="btn ghost" icon={<Sparkles size={16} />} capture={!upload} onFiles={(f) => scanLabel(f[0])} disabled={busy || ai.busy} />}
            <button className="btn ghost" onClick={() => onDone(blankIngredient(), 'Fyll inn varen.')}>Registrer manuelt</button>
          </div>
          <AiQuota ai={ai} />
          {info && <Notice tone={info.tone}>{info.text}</Notice>}
          {ai.error && <Notice tone="error">{ai.error}</Notice>}
          <p className="muted small">Strekkodeoppslag bruker ikke AI-kvoten. Produktdata fra <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a> (ODbL) kan være ufullstendige eller utdaterte.</p>
        </>
      )}
    </Card>
  )
}
