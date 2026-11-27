import { useState } from 'react'
import { Calculator, Clock, CookingPot, Gauge, Layers, Plus, Save, Trash2, Zap } from 'lucide-react'
import { BAKE_TYPES, type BakeType, type CustomerType, type EnergyInput, type Oven } from '../types'
import { useData, useFormat, useT } from '../hooks/useData'
import { useBakeResult } from '../hooks/useBakeResult'
import { Card, Notice, NumberField, PageHeader, Segmented, SelectField, TextField, Toggle } from '../components/ui'
import { ResultCards } from '../components/ResultCards'
import { SalesSummaryCard } from '../components/SalesSummaryCard'
import { canUse } from '../lib/plans'
import { formatKwh, formatMoney, formatNumber, formatOre, formatTime, uid } from '../utils/format'
import { navigate } from '../hooks/useRoute'
import type { PriceBasis } from '../context/dataContext'
import { withCustomerType } from '../utils/priceSettings'
import { useAuth } from '../hooks/useAuth'
import { useBusiness } from '../hooks/useBusiness'
import { useFeature } from '../hooks/useFeature'
import { consumption, consumptionMovements } from '../utils/inventory'
import { EquipmentUsesEditor } from '../components/EquipmentUsesEditor'
import { yieldWord } from '../lib/businessTypes'

export function CalculatorPage() {
  const t = useT()
  const f = useFormat()
  const { data, draft, setDraft, addLog, upsertRecipe, saveSettings, addStockMovements } = useData()
  const auth = useAuth()
  const { activeOrg } = auth
  // Salgsberegning: Plus/Pro (prøveperioden gir Pro). Uten Supabase (lokal modus) er alt åpent.
  const salesAllowed = !auth.configured || canUse(auth.plan, 'salesCalculator')
  const ps = data.settings.price
  // Medlemmer (ikke eier/admin) kan ikke endre organisasjonens strømoppsett – håndheves også i databasen
  const priceReadOnly = activeOrg?.role === 'member'
  const { result, pricePerKwh, priceSource, fallback, recipe, window } = useBakeResult()
  const [saved, setSaved] = useState(false)
  const inventory = useFeature('inventory')
  const [deductStock, setDeductStock] = useState(true)
  const [stockNote, setStockNote] = useState<string | null>(null)
  const { profile } = useBusiness()
  const unit = recipe?.yieldUnit ?? profile.defaultYieldUnit
  const unitWord = yieldWord(unit, draft.count)
  const bakery = profile.productionWord === 'baking'
  const registerMode = draft.energy.energySource === 'equipment'

  const setE = <K extends keyof EnergyInput>(k: K, v: EnergyInput[K]) => setDraft((d) => ({ ...d, energy: { ...d.energy, [k]: v } }))
  const e = draft.energy
  const extraOvens = e.extraOvens ?? []
  const setOven = (id: string, patch: Partial<Oven>) => setE('extraOvens', extraOvens.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  const addOven = () => setE('extraOvens', [...extraOvens, {
    id: uid(), name: `Ovn ${extraOvens.length + 2}`, watt: e.ovenWatt,
    preheatMinutes: e.preheatMinutes, preheatPowerPercent: e.preheatPowerPercent,
    bakeMinutes: e.bakeMinutes, bakePowerPercent: e.bakePowerPercent, rounds: e.rounds,
  }])

  const pickRecipe = (id: string) => {
    const r = data.recipes.find((x) => x.id === id)
    setDraft((d) => r
      ? { ...d, recipeId: r.id, name: r.name, type: r.type, count: r.yieldCount, storePricePerItem: r.storePricePerItem, energy: { ...r.energy, bakeMinutes: r.bakeMinutes || r.energy.bakeMinutes } }
      : { ...d, recipeId: null })
  }

  const save = async () => {
    await addLog({
      id: uid(), date: new Date().toISOString(), recipeId: draft.recipeId, recipeName: draft.name || recipe?.name || 'Bakst',
      type: draft.type, count: draft.count, kwh: result.energy.totalKwh, pricePerKwh, electricityCost: result.electricityCost,
      ingredientCost: result.ingredientCost, totalCost: result.totalCost, costPerItem: result.costPerItem ?? 0,
      storePricePerItem: draft.storePricePerItem, revenue: null, profit: null, note: '',
      // Øyeblikksbilde av beregningsgrunnlaget – endres ikke når priser oppdateres senere
      snapshot: {
        priceSource,
        energy: { parts: result.partCosts, measured: result.energy.measured },
        ingredients: result.ingredientLines.map((l) => ({ name: l.name, amount: l.amount, unit: l.unit, cost: l.cost })),
      },
    })
    // Trekk ingrediensene fra lageret (Business). Underoppskrifter regnes ned til ingrediensene.
    if (inventory.allowed && deductStock && recipe && !profile.hiddenRoutes.includes('lager')) {
      const { usage, skipped } = consumption(recipe, draft.count, data.recipes, data.ingredients)
      const moves = consumptionMovements(usage, data.ingredients, `Produksjon: ${draft.name || recipe.name} (${draft.count})`)
      await addStockMovements(moves)
      setStockNote(moves.length
        ? `${moves.length} ingrediens(er) er trukket fra lageret.${skipped.length ? ` Ikke trukket (enheten kan ikke regnes om): ${[...new Set(skipped)].join(', ')}.` : ''}`
        : null)
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <>
      <PageHeader
        title={profile.calculatorName}
        description="Resultatene oppdateres fortløpende mens du endrer verdiene."
        actions={<button className="btn primary" onClick={save} disabled={draft.count <= 0}><Save size={18} /> {saved ? 'Lagret i historikken' : `Lagre ${profile.productionWord}`}</button>}
      />

      <ResultCards result={result} pricePerKwh={pricePerKwh} priceSource={priceSource} count={draft.count} unit={unitWord} perUnit={yieldWord(unit, 1)} showSavings={profile.showStorePrice} />
      {stockNote && <Notice>{stockNote}</Notice>}
      {fallback && <Notice tone="warn">Strømpris er ikke tilgjengelig nå. Beregningen bruker reserveprisen {formatOre(pricePerKwh, f.locale)} fra Innstillinger.</Notice>}

      <div className="grid-2">
        <div className="stack">
          <Card title={bakery ? 'Baksten' : 'Produksjonen'} icon={CookingPot}>
            <div className="form-grid">
              <SelectField label="Oppskrift" value={draft.recipeId ?? ''} onChange={pickRecipe}
                options={[{ value: '', label: '— Ingen oppskrift —' }, ...data.recipes.map((r) => ({ value: r.id, label: r.name }))]} />
              <TextField label={bakery ? 'Navn på baksten' : 'Navn på produksjonen'} value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} placeholder={bakery ? 'F.eks. grove brød' : 'F.eks. dagens lunsj'} />
              {bakery && (
                <SelectField<BakeType> label="Type bakst" value={draft.type} onChange={(v) => setDraft((d) => ({ ...d, type: v }))}
                  options={BAKE_TYPES.map((b) => ({ value: b, label: t(`bakeType.${b}`) }))} />
              )}
              <NumberField label={bakery && unit === 'stk' ? 'Antall ferdige bakervarer' : `Antall ${yieldWord(unit)}`} value={draft.count} integer min={1} onChange={(v) => setDraft((d) => ({ ...d, count: v }))} suffix={unitWord}
                hint={recipe && draft.count !== recipe.yieldCount ? `Oppskriften skaleres ×${formatNumber(draft.count / recipe.yieldCount, 2, f.locale)}` : undefined} />
              {profile.showStorePrice && (
                <NumberField label="Butikkpris for tilsvarende vare" value={draft.storePricePerItem} onChange={(v) => setDraft((d) => ({ ...d, storePricePerItem: v }))} suffix={`kr/${yieldWord(unit, 1)}`} />
              )}
            </div>
            {inventory.allowed && recipe && !profile.hiddenRoutes.includes('lager') && (
              <Toggle label="Trekk ingrediensene fra lageret når jeg lagrer" checked={deductStock} onChange={setDeductStock} />
            )}
            {data.recipes.length === 0 && <Notice>Du har ingen oppskrifter ennå. <button className="link" onClick={() => navigate('oppskrifter')}>Opprett en oppskrift</button> for å få med ingredienskostnader.</Notice>}
          </Card>

          <Card title="Strømberegning" icon={Zap} actions={recipe && (
            <button className="link" onClick={() => upsertRecipe({ ...recipe, energy: draft.energy, bakeMinutes: draft.energy.bakeMinutes, updatedAt: new Date().toISOString() })}>
              Lagre oppsettet i oppskriften
            </button>
          )}>
            <EquipmentUsesEditor energy={draft.energy} onChange={(energy) => setDraft((d) => ({ ...d, energy }))} equipment={data.equipment} count={draft.count} unitWord={unitWord} />
          </Card>

          {!registerMode && <Card title="Ovn" icon={Gauge}>
            <div className="form-grid">
              <NumberField label={extraOvens.length ? 'Ovn 1 – effekt' : 'Ovnens effekt'} value={e.ovenWatt} onChange={(v) => setE('ovenWatt', v)} suffix="W" max={100000} hint="Står på typeskiltet. Hjemmeovn ofte 2000–3600 W, bakeriovn 10 000–40 000 W (10–40 kW)" />
              <NumberField label="Steketemperatur" value={e.temperatureC} onChange={(v) => setE('temperatureC', v)} suffix="°C" max={350} hint="Til informasjon – effekten styres av effektfaktoren" />
              <NumberField label="Forvarmingstid" value={e.preheatMinutes} onChange={(v) => setE('preheatMinutes', v)} suffix="min" max={120} />
              <NumberField label="Effekt under forvarming" value={e.preheatPowerPercent} onChange={(v) => setE('preheatPowerPercent', v)} suffix="%" max={100} hint="Vanligvis tilnærmet 100 %" />
              <NumberField label="Steketid per omgang" value={e.bakeMinutes} onChange={(v) => setE('bakeMinutes', v)} suffix="min" max={600} />
              <NumberField label="Snitteffekt under steking" value={e.bakePowerPercent} onChange={(v) => setE('bakePowerPercent', v)} suffix="%" max={100} hint="Termostaten slår av og på – typisk 40–70 %" />
              <NumberField label="Antall stekeomganger" value={e.rounds} integer min={1} max={20} onChange={(v) => setE('rounds', v)} hint="Forvarming regnes kun én gang" />
            </div>
            {extraOvens.map((o) => (
              <div key={o.id} className="oven-block">
                <div className="oven-head">
                  <TextField label="Navn" value={o.name} onChange={(v) => setOven(o.id, { name: v })} />
                  <button className="icon-btn danger" aria-label={`Fjern ${o.name}`} onClick={() => setE('extraOvens', extraOvens.filter((x) => x.id !== o.id))}><Trash2 size={18} /></button>
                </div>
                <div className="form-grid">
                  <NumberField label="Effekt" value={o.watt} suffix="W" max={100000} onChange={(v) => setOven(o.id, { watt: v })} />
                  <NumberField label="Forvarmingstid" value={o.preheatMinutes} suffix="min" max={120} onChange={(v) => setOven(o.id, { preheatMinutes: v })} />
                  <NumberField label="Effekt under forvarming" value={o.preheatPowerPercent} suffix="%" max={100} onChange={(v) => setOven(o.id, { preheatPowerPercent: v })} />
                  <NumberField label="Steketid per omgang" value={o.bakeMinutes} suffix="min" max={600} onChange={(v) => setOven(o.id, { bakeMinutes: v })} />
                  <NumberField label="Snitteffekt under steking" value={o.bakePowerPercent} suffix="%" max={100} onChange={(v) => setOven(o.id, { bakePowerPercent: v })} />
                  <NumberField label="Antall stekeomganger" value={o.rounds} integer min={0} max={20} onChange={(v) => setOven(o.id, { rounds: v })} />
                </div>
              </div>
            ))}
            <button className="btn ghost" onClick={addOven}><Plus size={16} /> Legg til ovn</button>
            {extraOvens.length > 0 && <p className="muted small">Ovnene regnes som brukt samtidig. Sett antall omganger til 0 for en ovn som bare forvarmes.</p>}
          </Card>}

          {!registerMode && <Card title="Kjøkkenmaskin og annet utstyr" icon={Zap}>
            <div className="form-grid">
              <NumberField label="Kjøkkenmaskinens effekt" value={e.mixerWatt} onChange={(v) => setE('mixerWatt', v)} suffix="W" max={5000} />
              <NumberField label="Brukstid" value={e.mixerMinutes} onChange={(v) => setE('mixerMinutes', v)} suffix="min" max={240} />
              <NumberField label="Snitteffekt" value={e.mixerPowerPercent} onChange={(v) => setE('mixerPowerPercent', v)} suffix="%" max={100} />
            </div>
            {e.otherEquipment.map((eq) => (
              <div key={eq.id} className="equipment-row">
                <TextField label="Utstyr" value={eq.name} onChange={(v) => setE('otherEquipment', e.otherEquipment.map((x) => x.id === eq.id ? { ...x, name: v } : x))} />
                <NumberField label="Effekt" value={eq.watt} suffix="W" max={100000} onChange={(v) => setE('otherEquipment', e.otherEquipment.map((x) => x.id === eq.id ? { ...x, watt: v } : x))} />
                <NumberField label="Tid" value={eq.minutes} suffix="min" max={1440} onChange={(v) => setE('otherEquipment', e.otherEquipment.map((x) => x.id === eq.id ? { ...x, minutes: v } : x))} />
                <NumberField label="Effekt" value={eq.powerFactorPercent} suffix="%" max={100} onChange={(v) => setE('otherEquipment', e.otherEquipment.map((x) => x.id === eq.id ? { ...x, powerFactorPercent: v } : x))} />
                <button className="icon-btn danger" aria-label={`Fjern ${eq.name}`} onClick={() => setE('otherEquipment', e.otherEquipment.filter((x) => x.id !== eq.id))}><Trash2 size={18} /></button>
              </div>
            ))}
            <button className="btn ghost" onClick={() => setE('otherEquipment', [...e.otherEquipment, { id: uid(), name: 'Hevebox', watt: 100, minutes: 60, powerFactorPercent: 50 }])}><Plus size={16} /> Legg til utstyr</button>
          </Card>}

          <Card title="Målt forbruk" icon={Gauge}>
            <Toggle label="Bruk faktisk målt strømforbruk" hint="F.eks. fra strømmåler-app eller måleplugg. Erstatter estimatet." checked={e.useMeasured} onChange={(v) => setE('useMeasured', v)} />
            {e.useMeasured && <div className="form-grid"><NumberField label="Målt forbruk" value={e.measuredKwh} onChange={(v) => setE('measuredKwh', v)} suffix="kWh" max={10000} /></div>}
          </Card>
        </div>

        <div className="stack">
          <Card title="Strømpris i beregningen" icon={Clock}>
            <div className="field">
              <span className="label">Kundetype</span>
              <Segmented<CustomerType> label="Kundetype" value={ps.customerType} disabled={priceReadOnly}
                onChange={(v) => { if (!priceReadOnly) saveSettings({ ...data.settings, price: withCustomerType(ps, v) }) }}
                options={[{ value: 'bedrift', label: t('customerType.bedrift') }, { value: 'privat', label: t('customerType.privat') }]} />
              <small className="muted">
                {priceReadOnly
                  ? 'Bare eier eller administrator kan endre kundetype.'
                  : ps.customerType === 'bedrift'
                    ? `Ingen Norgespris eller strømstøtte.${ps.vatDeductible ? ' Kostnad eks. mva.' : ''}`
                    : 'Inkl. mva, med strømstøtte eller Norgespris.'}
              </small>
            </div>
            <div className="field">
              <span className="label">Pris i beregningen</span>
              <Segmented<PriceBasis> label="Pris i beregningen" value={draft.priceBasis} onChange={(v) => setDraft((d) => ({ ...d, priceBasis: v }))}
                options={[{ value: 'now', label: 'Nå' }, { value: 'average', label: 'Dagens snitt' }, { value: 'cheapest', label: 'Billigste tid' }]} />
            </div>
            {window ? (
              <p className="callout">
                {bakery ? 'Billigst å bake' : 'Billigst å produsere'}: <strong>{formatTime(window.start, f.locale)}–{formatTime(window.end, f.locale)}</strong>
                {new Date(window.start).getDate() !== new Date().getDate() && ' i morgen'} · ovnen koster {formatMoney(window.cost, f)} ({formatOre(window.avgPricePerKwh, f.locale)})
              </p>
            ) : <p className="muted small">Billigste tidspunkt krever spotpriser for resten av døgnet.</p>}
            <button className="link" onClick={() => navigate('strompriser')}>Se prisgraf og prisoppbygging →</button>
          </Card>

          {ps.customerType === 'bedrift' && (
            <SalesSummaryCard
              sales={draft.sales}
              onChange={(s) => setDraft((d) => ({ ...d, sales: s }))}
              units={draft.count}
              ingredientCost={result.ingredientCost}
              electricityCost={result.electricityCost}
              allowed={salesAllowed}
              loggedIn={!!auth.user}
            />
          )}

          <Card title="Strømforbruk per del" icon={Calculator}>
            <table className="clean">
              <thead><tr><th>Del</th><th className="num">kWh</th><th className="num">Kostnad</th></tr></thead>
              <tbody>
                {result.partCosts.map((p) => (
                  <tr key={p.key}><td>{p.label}</td><td className="num">{formatNumber(p.kwh, 3, f.locale)}</td><td className="num">{formatMoney(p.cost, f)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td>Totalt</td><td className="num">{formatNumber(result.energy.totalKwh, 3, f.locale)}</td><td className="num">{formatMoney(result.electricityCost, f)}</td></tr></tfoot>
            </table>
            {result.energy.measured && <p className="muted small">Målt forbruk er fordelt proporsjonalt etter estimatet ({formatKwh(result.energy.estimatedKwh, f.locale)}).</p>}
          </Card>

          {result.ingredientLines.length > 0 && (
            <Card title="Ingredienser" icon={CookingPot}>
              <table className="clean">
                <thead><tr><th>Ingrediens</th><th className="num">Mengde</th><th className="num">Kostnad</th></tr></thead>
                <tbody>
                  {result.ingredientLines.map((l) => (
                    <tr key={l.recipeIngredientId} className={l.cost === null ? 'warn-row' : ''}>
                      <td>{l.name}{l.error && <small className="error block">{l.error}</small>}</td>
                      <td className="num">{formatNumber(l.amount, 1, f.locale)} {l.unit}</td>
                      <td className="num">{formatMoney(l.cost, f)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={2}>Sum</td><td className="num">{formatMoney(result.ingredientCost, f)}</td></tr></tfoot>
              </table>
            </Card>
          )}

          <Card title="Bak flere samtidig" icon={Layers}>
            <p className="muted small">Forutsetter at ovnen har plass. Ovnens strøm deles på flere, mens ingredienser og kjøkkenmaskin øker.</p>
            <table className="clean">
              <thead><tr><th>Mengde</th><th className="num">Strøm</th><th className="num">Totalt</th><th className="num">Per stk</th></tr></thead>
              <tbody>
                {result.batch.map((b) => (
                  <tr key={b.multiplier}>
                    <td>{b.count} stk {b.multiplier > 1 && <span className="muted">(×{b.multiplier})</span>}</td>
                    <td className="num">{formatMoney(b.electricityCost, f)}</td>
                    <td className="num">{formatMoney(b.totalCost, f)}</td>
                    <td className="num"><strong>{formatMoney(b.costPerItem, f)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.batch.length > 1 && result.batch[0].costPerItem > 0 && (
              <p className="callout">Dobbel porsjon sparer {formatMoney(result.batch[0].costPerItem - result.batch[1].costPerItem, f)} per stk – {formatMoney((result.batch[0].costPerItem - result.batch[1].costPerItem) * result.batch[1].count, f)} per baking.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
