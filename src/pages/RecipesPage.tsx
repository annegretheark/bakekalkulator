import { useState } from 'react'
import { ArrowLeft, BookOpen, Calculator, Clock, Copy, Gauge, Layers, Pencil, Plus, Scale, ScanText, ShieldAlert, Trash2, Users, Wheat } from 'lucide-react'
import { ALLERGEN_CODES, BAKE_TYPES, RECIPE_CATEGORIES, UNITS, type BakeType, type Recipe, type RecipeCategory, type Unit, type YieldUnit } from '../types'
import { useData, useFormat, useT } from '../hooks/useData'
import { useAuth } from '../hooks/useAuth'
import { useRecipeBreakdown, useReferencePrice, type RecipeBreakdown } from '../hooks/useRecipeCosts'
import { useBusiness } from '../hooks/useBusiness'
import { Card, EmptyState, Notice, NumberField, PageHeader, Segmented, SelectField, TextField } from '../components/ui'
import { EquipmentUsesEditor } from '../components/EquipmentUsesEditor'
import { defaultEnergyInput } from '../lib/defaults'
import { RECIPE_CATEGORY_NAMES, yieldWord, type BusinessProfile } from '../lib/businessTypes'
import { recipesUsingSub, subRecipeCandidates } from '../utils/recipeCost'
import { LaborEditor } from '../components/LaborEditor'
import { AllergenProfileView } from '../components/Allergens'
import { ALLERGEN_NAMES } from '../lib/allergens'
import { formatMoney, formatNumber, uid } from '../utils/format'
import { isCompatible } from '../utils/units'
import { bakeTypeForCategory, costPerKg, scaledWeightG, weightPerUnitG } from '../utils/portions'
import { navigate } from '../hooks/useRoute'
import { RecipeScanPanel } from '../components/ScanPanels'
import { takeRecipe } from '../lib/scanHandoff'

const newRecipe = (p: BusinessProfile): Recipe => {
  const now = new Date().toISOString()
  return {
    id: uid(), name: '', type: bakeTypeForCategory(p.defaultCategory, 'brod'), category: p.defaultCategory,
    yieldCount: p.defaultYieldUnit === 'porsjoner' ? 4 : 1, yieldUnit: p.defaultYieldUnit, prepMinutes: 0, finishedWeightG: null,
    ingredients: [], labor: [], packagingPerUnit: 0, crossContact: [], steps: [''], riseMinutes: p.defaultCategory === 'brod_bakervarer' ? 60 : 0, bakeMinutes: p.defaultCategory === 'brod_bakervarer' ? 45 : 0,
    storePricePerItem: 0, notes: '', energy: defaultEnergyInput(), createdAt: now, updatedAt: now,
  }
}

const BAKERY_TYPES: BakeType[] = BAKE_TYPES.filter((b) => b !== 'pizza' && b !== 'annet')

export function RecipesPage() {
  const t = useT()
  const f = useFormat()
  const { data, upsertRecipe, deleteRecipe, setDraft } = useData()
  const { profile } = useBusiness()
  const auth = useAuth()
  const canEditCosts = !(auth.user && auth.activeOrg && auth.activeOrg.role === 'member')
  const breakdown = useRecipeBreakdown()
  const { source: priceSource } = useReferencePrice()
  const [handoff] = useState(() => takeRecipe())
  const [editing, setEditing] = useState<Recipe | null>(handoff?.draft ?? null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [scaleTo, setScaleTo] = useState<number | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanInfo, setScanInfo] = useState<string | null>(handoff?.message ?? null)
  const [filter, setFilter] = useState<RecipeCategory | ''>('')

  const openInCalculator = (r: Recipe, count = r.yieldCount) => {
    setDraft((d) => ({ ...d, recipeId: r.id, name: r.name, type: r.type, count, storePricePerItem: r.storePricePerItem, energy: { ...r.energy, bakeMinutes: r.bakeMinutes || r.energy.bakeMinutes } }))
    navigate('kalkulator')
  }

  const copy = (r: Recipe) => {
    const now = new Date().toISOString()
    upsertRecipe({ ...structuredClone(r), id: uid(), name: `${r.name} (kopi)`, ingredients: r.ingredients.map((i) => ({ ...i, id: uid() })), createdAt: now, updatedAt: now })
  }

  const remove = (r: Recipe) => {
    const users = recipesUsingSub(data.recipes, r.id)
    const warn = users.length ? ` Den brukes som underoppskrift i ${users.map((u) => `«${u.name}»`).join(', ')}, og disse mister kostnaden fra den.` : ''
    if (confirm(`Slette «${r.name}»?${warn} Historikken beholdes.`)) deleteRecipe(r.id)
  }

  // ---------- Redigering ----------
  if (editing) {
    const e = editing
    const set = (p: Partial<Recipe>) => setEditing({ ...e, ...p })
    const valid = e.name.trim() && e.yieldCount > 0 && e.ingredients.every((i) => (i.ingredientId || i.subRecipeId) && i.amount >= 0)
    const others = data.recipes.filter((r) => r.id !== e.id)
    const bd = breakdown(e, e.yieldCount, [...others, e])
    const live = bd.bake
    const word = yieldWord(e.yieldUnit)
    const perKg = costPerKg(bd.total, scaledWeightG(e, e.yieldCount))
    const subs = subRecipeCandidates([...others, e], e.id).filter((r) => r.id !== e.id)
    const lineOptions = [
      { value: '', label: '— Velg —' },
      ...data.ingredients.map((i) => ({ value: i.id, label: i.name })),
      ...subs.map((r) => ({ value: `sub:${r.id}`, label: `Underoppskrift: ${r.name}` })),
    ]
    const isBakery = e.category === 'brod_bakervarer'
    return (
      <>
        <PageHeader title={data.recipes.some((r) => r.id === e.id) ? 'Rediger oppskrift' : 'Ny oppskrift'}
          actions={<button className="btn ghost" onClick={() => setEditing(null)}><ArrowLeft size={16} /> Tilbake</button>} />
        {scanInfo && <Notice>{scanInfo}</Notice>}
        <div className="grid-2 wide-left">
          <div className="stack">
            <Card title="Grunninfo" icon={BookOpen}>
              <div className="form-grid">
                <TextField label="Navn" required value={e.name} onChange={(v) => set({ name: v })} placeholder="F.eks. Grove brød eller Lasagne" />
                <SelectField<RecipeCategory> label="Kategori" value={e.category} onChange={(v) => set({ category: v, type: bakeTypeForCategory(v, e.type) })}
                  options={RECIPE_CATEGORIES.map((c) => ({ value: c, label: RECIPE_CATEGORY_NAMES[c] }))} />
                {isBakery && (
                  <SelectField<BakeType> label="Type bakervare" value={BAKERY_TYPES.includes(e.type) ? e.type : 'brod'} onChange={(v) => set({ type: v })}
                    options={BAKERY_TYPES.map((b) => ({ value: b, label: t(`bakeType.${b}`) }))} />
                )}
                <NumberField label="Gir antall" value={e.yieldCount} integer min={1} onChange={(v) => set({ yieldCount: v })} suffix={word} />
                <div className="field">
                  <span className="label">Antall regnes i</span>
                  <Segmented<YieldUnit> label="Antall regnes i" value={e.yieldUnit} onChange={(v) => set({ yieldUnit: v })}
                    options={[{ value: 'stk', label: 'Stk' }, { value: 'porsjoner', label: 'Porsjoner' }]} />
                </div>
                <NumberField label="Ferdig vekt, hele oppskriften" value={e.finishedWeightG ?? 0} onChange={(v) => set({ finishedWeightG: v > 0 ? v : null })} suffix="g" max={10000000}
                  hint="Valgfritt. Gir kostnad per kilo og vekt per porsjon." />
              </div>
            </Card>

            <Card title="Tider" icon={Clock}>
              <div className="form-grid">
                <NumberField label="Tilberedningstid" value={e.prepMinutes} onChange={(v) => set({ prepMinutes: v })} suffix="min" max={10080} hint="Aktiv tid, f.eks. kutting og forming" />
                <NumberField label="Hevetid" value={e.riseMinutes} onChange={(v) => set({ riseMinutes: v })} suffix="min" max={2880} />
                <NumberField label="Steke-/koketid" value={e.bakeMinutes} onChange={(v) => set({ bakeMinutes: v, energy: { ...e.energy, bakeMinutes: v } })} suffix="min" max={600} />
                <NumberField label="Temperatur" value={e.energy.temperatureC} onChange={(v) => set({ energy: { ...e.energy, temperatureC: v } })} suffix="°C" max={500} />
                {profile.showStorePrice && (
                  <NumberField label="Butikkpris tilsvarende" value={e.storePricePerItem} onChange={(v) => set({ storePricePerItem: v })} suffix={`kr/${e.yieldUnit === 'porsjoner' ? 'porsjon' : 'stk'}`} />
                )}
              </div>
            </Card>

            <Card title="Ingredienser og underoppskrifter" icon={Wheat}>
              {data.ingredients.length === 0 && <Notice tone="warn">Registeret er tomt. <button className="link" onClick={() => navigate('ingredienser')}>Legg inn ingredienser</button> først.</Notice>}
              {e.ingredients.map((ri, idx) => {
                const ing = ri.subRecipeId ? undefined : data.ingredients.find((i) => i.id === ri.ingredientId)
                const incompatible = ing && !isCompatible(ing.unit, ri.unit)
                const subError = ri.subRecipeId ? live.ingredientLines[idx]?.error : undefined
                return (
                  <div key={ri.id} className="ingredient-row">
                    <SelectField label={idx === 0 ? 'Ingrediens' : ''} value={ri.subRecipeId ? `sub:${ri.subRecipeId}` : ri.ingredientId} onChange={(v) => {
                      if (v.startsWith('sub:')) {
                        const subId = v.slice(4)
                        const sub = data.recipes.find((r) => r.id === subId)
                        const unit: Unit = sub?.finishedWeightG ? 'g' : 'stk'
                        set({ ingredients: e.ingredients.map((x) => (x.id === ri.id ? { ...x, ingredientId: '', subRecipeId: subId, unit } : x)) })
                        return
                      }
                      const target = data.ingredients.find((i) => i.id === v)
                      const unit: Unit = target && !isCompatible(target.unit, ri.unit) ? (target.unit === 'kg' ? 'g' : target.unit === 'l' ? 'dl' : target.unit) : ri.unit
                      set({ ingredients: e.ingredients.map((x) => (x.id === ri.id ? { ...x, ingredientId: v, subRecipeId: null, unit } : x)) })
                    }} options={ri.subRecipeId && !subs.some((r) => r.id === ri.subRecipeId)
                      ? [...lineOptions, { value: `sub:${ri.subRecipeId}`, label: 'Underoppskrift (finnes ikke / sirkulær)' }]
                      : lineOptions} />
                    <NumberField label={idx === 0 ? 'Mengde' : ''} value={ri.amount} onChange={(v) => set({ ingredients: e.ingredients.map((x) => (x.id === ri.id ? { ...x, amount: v } : x)) })} />
                    <SelectField<Unit> label={idx === 0 ? 'Enhet' : ''} value={ri.unit} onChange={(v) => set({ ingredients: e.ingredients.map((x) => (x.id === ri.id ? { ...x, unit: v } : x)) })} options={UNITS.map((u) => ({ value: u, label: u }))} />
                    <span className="num row-cost">{formatMoney(live.ingredientLines[idx]?.cost ?? null, f)}</span>
                    <button className="icon-btn danger" aria-label="Fjern ingrediens" onClick={() => set({ ingredients: e.ingredients.filter((x) => x.id !== ri.id) })}><Trash2 size={16} /></button>
                    {subError && <small className="error full">{subError}</small>}
                    {incompatible && <small className="error full">Kan ikke regne {ri.unit} om til {ing.unit} uten kjent tetthet. Velg en {ing.unit === 'stk' ? 'stk' : ['g', 'kg'].includes(ing.unit) ? 'vektenhet' : 'volumenhet'}.</small>}
                  </div>
                )
              })}
              <button className="btn ghost" disabled={data.ingredients.length === 0} onClick={() => set({ ingredients: [...e.ingredients, { id: uid(), ingredientId: data.ingredients[0]?.id ?? '', amount: 100, unit: data.ingredients[0]?.unit === 'kg' ? 'g' : data.ingredients[0]?.unit ?? 'g' }] })}><Plus size={16} /> Legg til ingrediens</button>
              {subs.length > 0 && <p className="muted small"><Layers size={14} aria-hidden /> Velg «Underoppskrift» i listen for å bruke en saus, deig eller dressing. Mengden oppgis i g/kg (krever ferdig vekt) eller stk/porsjoner.</p>}
            </Card>

            <Card title="Arbeidstid og emballasje" icon={Users}>
              <LaborEditor lines={e.labor} roles={data.costs.staffRoles} onChange={(labor) => set({ labor })} canEditRoles={canEditCosts} />
              <div className="form-grid">
                <NumberField label="Emballasje" value={e.packagingPerUnit} max={100000} onChange={(v) => set({ packagingPerUnit: v })} suffix={`kr/${yieldWord(e.yieldUnit, 1)}`} hint="Boks, pose, beger, serviett" />
              </div>
            </Card>

            <Card title="Allergener" icon={ShieldAlert}>
              <AllergenProfileView profile={bd.full.base.allergens} />
              {bd.full.base.uncheckedAllergens && <Notice tone="warn">Noen ingredienser har allergener som ikke er kontrollert. Kontroller dem under Ingredienser.</Notice>}
              <fieldset className="checks">
                <legend>Risiko for krysskontakt i produksjonen</legend>
                <div className="check-grid">
                  {ALLERGEN_CODES.map((c) => (
                    <label key={c} className="check">
                      <input type="checkbox" checked={e.crossContact.includes(c)}
                        onChange={(ev) => set({ crossContact: ev.target.checked ? [...e.crossContact, c] : e.crossContact.filter((x) => x !== c) })} />
                      {ALLERGEN_NAMES[c]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="muted small">Allergenene beregnes fra ingrediensene og underoppskriftene. Et allergen vises bare som «Inneholder ikke» når alle ingrediensene er kontrollert for det.</p>
            </Card>

            <Card title="Utstyr og strøm" icon={Gauge}>
              <EquipmentUsesEditor energy={e.energy} onChange={(energy) => set({ energy })} equipment={data.equipment} count={e.yieldCount} unitWord={word} />
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
              <CostList bd={bd} unit={yieldWord(e.yieldUnit, 1)} perKg={perKg} />
              {profile.showStorePrice && live.savings && <dl className="kv"><dt>Spart per {profile.productionWord}</dt><dd>{formatMoney(live.savings.perBake, f)}</dd></dl>}
              {live.missingIngredientCosts > 0 && <Notice tone="warn">{live.missingIngredientCosts} linje(r) kan ikke prisberegnes.</Notice>}
              <p className="muted small">Strøm estimeres med oppskriftens utstyr og {priceSource}.</p>
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
    const bd = breakdown(shown, count)
    const res = bd.bake
    const word = yieldWord(shown.yieldUnit, count)
    const weight = scaledWeightG(shown, count)
    const perKg = costPerKg(bd.total, weight)
    const perUnitWeight = weightPerUnitG(shown)
    return (
      <>
        <PageHeader title={shown.name} description={`${RECIPE_CATEGORY_NAMES[shown.category]} · gir ${shown.yieldCount} ${yieldWord(shown.yieldUnit, shown.yieldCount)}`}
          actions={<>
            <button className="btn ghost" onClick={() => { setViewing(null); setScaleTo(null) }}><ArrowLeft size={16} /> Alle oppskrifter</button>
            <button className="btn ghost" onClick={() => setEditing(structuredClone(shown))}><Pencil size={16} /> Rediger</button>
            <button className="btn primary" onClick={() => openInCalculator(shown, count)}><Calculator size={16} /> Beregn</button>
          </>} />
        <div className="grid-2 wide-left">
          <div className="stack">
            <Card title="Ingredienser" icon={Wheat} actions={
              <div className="scale-ctl"><Scale size={16} aria-hidden /><NumberField label="Skaler til" value={count} integer min={1} max={100000} onChange={(v) => setScaleTo(v)} suffix={word} /></div>
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
                {shown.prepMinutes > 0 && <><dt><Clock size={14} /> Tilberedning</dt><dd>{shown.prepMinutes} min</dd></>}
                {shown.riseMinutes > 0 && <><dt><Clock size={14} /> Hevetid</dt><dd>{shown.riseMinutes} min</dd></>}
                <dt><Clock size={14} /> Steke-/koketid</dt><dd>{shown.bakeMinutes} min{shown.energy.temperatureC ? ` · ${shown.energy.temperatureC} °C` : ''}</dd>
              </dl>
              <CostList bd={bd} unit={yieldWord(shown.yieldUnit, 1)} perKg={perKg} label={`${count} ${word}`} />
              <dl className="kv">
                {perUnitWeight !== null && <><dt>Vekt per {yieldWord(shown.yieldUnit, 1)}</dt><dd>{formatNumber(perUnitWeight, 0, f.locale)} g</dd></>}
                {profile.showStorePrice && <><dt>Butikkpris</dt><dd>{shown.storePricePerItem ? formatMoney(shown.storePricePerItem, f) : '–'}</dd></>}
                {profile.showStorePrice && res.savings && <><dt>Spart per {profile.productionWord}</dt><dd className="pos">{formatMoney(res.savings.perBake, f)}</dd></>}
              </dl>
              {shown.energy.energySource === 'equipment' && (shown.energy.equipmentUses?.length ?? 0) > 0 && (
                <p className="muted small">Utstyr: {shown.energy.equipmentUses!.map((u) => u.name).join(', ')}</p>
              )}
            </Card>
            <Card title="Allergener" icon={ShieldAlert}>
              <AllergenProfileView profile={bd.full.base.allergens} />
              {bd.full.base.uncheckedAllergens && <Notice tone="warn">Noen ingredienser har allergener som ikke er kontrollert.</Notice>}
            </Card>
          </div>
        </div>
      </>
    )
  }

  // ---------- Liste ----------
  const usedCategories = RECIPE_CATEGORIES.filter((c) => data.recipes.some((r) => r.category === c))
  const list = filter ? data.recipes.filter((r) => r.category === filter) : data.recipes
  return (
    <>
      <PageHeader title="Mine oppskrifter" description="Kostnadene beregnes automatisk fra ingrediensregisteret og dagens strømpris."
        actions={<>
          <button className="btn ghost" onClick={() => setScanning(true)}><ScanText size={18} /> Skann oppskrift</button>
          <button className="btn primary" onClick={() => setEditing(newRecipe(profile))}><Plus size={18} /> Ny oppskrift</button>
        </>} />
      {scanning && (
        <RecipeScanPanel onCancel={() => setScanning(false)} onDone={(r, created) => {
          setScanning(false)
          setScanInfo(`Oppskriften er tolket fra bildet. Kontroller ingredienser, mengder og steg før du lagrer.${created ? ` ${created} ny(e) ingrediens(er) er lagt til uten pris – oppdater prisen under Ingredienser.` : ''}`)
          setEditing(r)
        }} />
      )}
      {usedCategories.length > 1 && (
        <div className="form-grid">
          <SelectField<RecipeCategory | ''> label="Vis kategori" value={filter} onChange={setFilter}
            options={[{ value: '', label: 'Alle kategorier' }, ...usedCategories.map((c) => ({ value: c, label: RECIPE_CATEGORY_NAMES[c] }))]} />
        </div>
      )}
      {data.recipes.length === 0 ? (
        <EmptyState icon={BookOpen} title="Ingen oppskrifter ennå" text="Lag din første oppskrift, så ser du hva hver rett eller bakst faktisk koster."
          action={<button className="btn primary" onClick={() => setEditing(newRecipe(profile))}><Plus size={18} /> Ny oppskrift</button>} />
      ) : (
        <div className="cards-grid">
          {list.map((r) => {
            const bd = breakdown(r)
            const res = bd.bake
            const per = yieldWord(r.yieldUnit, 1)
            return (
              <article key={r.id} className="recipe-card">
                <button className="recipe-main" onClick={() => setViewing(r.id)}>
                  <span className="pill">{RECIPE_CATEGORY_NAMES[r.category]}</span>
                  <h3>{r.name}</h3>
                  <p className="muted small">{r.yieldCount} {yieldWord(r.yieldUnit, r.yieldCount)} · {r.ingredients.length} linjer · {r.prepMinutes + r.riseMinutes + r.bakeMinutes} min</p>
                  <div className="recipe-figures">
                    <span><small>Totalt</small><strong>{formatMoney(bd.total, f)}</strong></span>
                    <span><small>Per {per}</small><strong>{formatMoney(bd.perUnit, f)}</strong></span>
                    {profile.showStorePrice && res.savings && <span><small>Spart</small><strong className="pos">{formatMoney(res.savings.perBake, f, 0)}</strong></span>}
                  </div>
                </button>
                <div className="recipe-actions">
                  <button className="icon-btn" aria-label="Beregn" title="Åpne i kalkulator" onClick={() => openInCalculator(r)}><Calculator size={16} /></button>
                  <button className="icon-btn" aria-label="Rediger" title="Rediger" onClick={() => setEditing(structuredClone(r))}><Pencil size={16} /></button>
                  <button className="icon-btn" aria-label="Kopier" title="Kopier" onClick={() => copy(r)}><Copy size={16} /></button>
                  <button className="icon-btn danger" aria-label="Slett" title="Slett" onClick={() => remove(r)}><Trash2 size={16} /></button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}

/** Kostnadsoppstilling: råvarer, strøm, personal, emballasje, drift. Tomme poster vises ikke. */
function CostList({ bd, unit, perKg, label }: { bd: RecipeBreakdown; unit: string; perKg: number | null; label?: string }) {
  const f = useFormat()
  return (
    <>
      <dl className="kv">
        <dt>Råvarer</dt><dd>{formatMoney(bd.bake.ingredientCost, f)}</dd>
        <dt>Strøm (estimert)</dt><dd>{formatMoney(bd.bake.electricityCost, f)}</dd>
        {bd.labor > 0 && <><dt>Personal</dt><dd>{formatMoney(bd.labor, f)}</dd></>}
        {bd.packaging > 0 && <><dt>Emballasje</dt><dd>{formatMoney(bd.packaging, f)}</dd></>}
        {bd.overhead > 0 && <><dt>Driftskostnader</dt><dd>{formatMoney(bd.overhead, f)}</dd></>}
        <dt>Totalt{label ? ` (${label})` : ''}</dt><dd><strong>{formatMoney(bd.total, f)}</strong></dd>
        <dt>Per {unit}</dt><dd><strong>{formatMoney(bd.perUnit, f)}</strong></dd>
        {perKg !== null && <><dt>Per kilo</dt><dd>{formatMoney(perKg, f)}</dd></>}
      </dl>
      {bd.full.overheadMissing && <Notice tone="warn">Driftskostnadene er ikke fordelt: oppgi antall per måned under Kostnader.</Notice>}
    </>
  )
}
