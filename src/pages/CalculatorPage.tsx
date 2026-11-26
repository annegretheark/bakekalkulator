import { useState } from 'react'
import { Calculator, Clock, CookingPot, Gauge, Layers, Plus, Save, Trash2, Zap } from 'lucide-react'
import { BAKE_TYPES, type BakeType, type CustomerType, type EnergyInput } from '../types'
import { useData, useFormat, useT } from '../hooks/useData'
import { useBakeResult } from '../hooks/useBakeResult'
import { Card, Notice, NumberField, PageHeader, Segmented, SelectField, TextField, Toggle } from '../components/ui'
import { ResultCards } from '../components/ResultCards'
import { formatKwh, formatMoney, formatNumber, formatOre, formatTime, uid } from '../utils/format'
import { navigate } from '../hooks/useRoute'
import type { PriceBasis } from '../context/dataContext'
import { withCustomerType } from '../utils/priceSettings'
import { useAuth } from '../hooks/useAuth'

export function CalculatorPage() {
  const t = useT()
  const f = useFormat()
  const { data, draft, setDraft, addLog, upsertRecipe, saveSettings } = useData()
  const { activeOrg } = useAuth()
  const ps = data.settings.price
  // Medlemmer (ikke eier/admin) kan ikke endre organisasjonens strømoppsett – håndheves også i databasen
  const priceReadOnly = activeOrg?.role === 'member'
  const { result, pricePerKwh, priceSource, fallback, recipe, window } = useBakeResult()
  const [saved, setSaved] = useState(false)

  const setE = <K extends keyof EnergyInput>(k: K, v: EnergyInput[K]) => setDraft((d) => ({ ...d, energy: { ...d.energy, [k]: v } }))
  const e = draft.energy

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
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <>
      <PageHeader
        title="Bakekalkulator"
        description="Resultatene oppdateres fortløpende mens du endrer verdiene."
        actions={<button className="btn primary" onClick={save} disabled={draft.count <= 0}><Save size={18} /> {saved ? 'Lagret i historikken' : 'Lagre baking'}</button>}
      />

      <ResultCards result={result} pricePerKwh={pricePerKwh} priceSource={priceSource} count={draft.count} />
      {fallback && <Notice tone="warn">Strømpris er ikke tilgjengelig nå. Beregningen bruker reserveprisen {formatOre(pricePerKwh, f.locale)} fra Innstillinger.</Notice>}

      <div className="grid-2">
        <div className="stack">
          <Card title="Baksten" icon={CookingPot}>
            <div className="form-grid">
              <SelectField label="Oppskrift" value={draft.recipeId ?? ''} onChange={pickRecipe}
                options={[{ value: '', label: '— Ingen oppskrift —' }, ...data.recipes.map((r) => ({ value: r.id, label: r.name }))]} />
              <TextField label="Navn på baksten" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} placeholder="F.eks. grove brød" />
              <SelectField<BakeType> label="Type bakst" value={draft.type} onChange={(v) => setDraft((d) => ({ ...d, type: v }))}
                options={BAKE_TYPES.map((b) => ({ value: b, label: t(`bakeType.${b}`) }))} />
              <NumberField label="Antall ferdige bakervarer" value={draft.count} integer min={1} onChange={(v) => setDraft((d) => ({ ...d, count: v }))} suffix="stk"
                hint={recipe && draft.count !== recipe.yieldCount ? `Oppskriften skaleres ×${formatNumber(draft.count / recipe.yieldCount, 2, f.locale)}` : undefined} />
              <NumberField label="Butikkpris for tilsvarende vare" value={draft.storePricePerItem} onChange={(v) => setDraft((d) => ({ ...d, storePricePerItem: v }))} suffix="kr/stk" />
            </div>
            {data.recipes.length === 0 && <Notice>Du har ingen oppskrifter ennå. <button className="link" onClick={() => navigate('oppskrifter')}>Opprett en oppskrift</button> for å få med ingredienskostnader.</Notice>}
          </Card>

          <Card title="Ovn" icon={Gauge} actions={recipe && (
            <button className="link" onClick={() => upsertRecipe({ ...recipe, energy: draft.energy, bakeMinutes: draft.energy.bakeMinutes, updatedAt: new Date().toISOString() })}>
              Lagre ovnsoppsett i oppskriften
            </button>
          )}>
            <div className="form-grid">
              <NumberField label="Ovnens effekt" value={e.ovenWatt} onChange={(v) => setE('ovenWatt', v)} suffix="W" max={20000} hint="Står på typeskiltet, ofte 2000–3600 W" />
              <NumberField label="Steketemperatur" value={e.temperatureC} onChange={(v) => setE('temperatureC', v)} suffix="°C" max={350} hint="Til informasjon – effekten styres av effektfaktoren" />
              <NumberField label="Forvarmingstid" value={e.preheatMinutes} onChange={(v) => setE('preheatMinutes', v)} suffix="min" max={120} />
              <NumberField label="Effekt under forvarming" value={e.preheatPowerPercent} onChange={(v) => setE('preheatPowerPercent', v)} suffix="%" max={100} hint="Vanligvis tilnærmet 100 %" />
              <NumberField label="Steketid per omgang" value={e.bakeMinutes} onChange={(v) => setE('bakeMinutes', v)} suffix="min" max={600} />
              <NumberField label="Snitteffekt under steking" value={e.bakePowerPercent} onChange={(v) => setE('bakePowerPercent', v)} suffix="%" max={100} hint="Termostaten slår av og på – typisk 40–70 %" />
              <NumberField label="Antall stekeomganger" value={e.rounds} integer min={1} max={20} onChange={(v) => setE('rounds', v)} hint="Forvarming regnes kun én gang" />
            </div>
          </Card>

          <Card title="Kjøkkenmaskin og annet utstyr" icon={Zap}>
            <div className="form-grid">
              <NumberField label="Kjøkkenmaskinens effekt" value={e.mixerWatt} onChange={(v) => setE('mixerWatt', v)} suffix="W" max={5000} />
              <NumberField label="Brukstid" value={e.mixerMinutes} onChange={(v) => setE('mixerMinutes', v)} suffix="min" max={240} />
              <NumberField label="Snitteffekt" value={e.mixerPowerPercent} onChange={(v) => setE('mixerPowerPercent', v)} suffix="%" max={100} />
            </div>
            {e.otherEquipment.map((eq) => (
              <div key={eq.id} className="equipment-row">
                <TextField label="Utstyr" value={eq.name} onChange={(v) => setE('otherEquipment', e.otherEquipment.map((x) => x.id === eq.id ? { ...x, name: v } : x))} />
                <NumberField label="Effekt" value={eq.watt} suffix="W" max={10000} onChange={(v) => setE('otherEquipment', e.otherEquipment.map((x) => x.id === eq.id ? { ...x, watt: v } : x))} />
                <NumberField label="Tid" value={eq.minutes} suffix="min" max={1440} onChange={(v) => setE('otherEquipment', e.otherEquipment.map((x) => x.id === eq.id ? { ...x, minutes: v } : x))} />
                <NumberField label="Effekt" value={eq.powerFactorPercent} suffix="%" max={100} onChange={(v) => setE('otherEquipment', e.otherEquipment.map((x) => x.id === eq.id ? { ...x, powerFactorPercent: v } : x))} />
                <button className="icon-btn danger" aria-label={`Fjern ${eq.name}`} onClick={() => setE('otherEquipment', e.otherEquipment.filter((x) => x.id !== eq.id))}><Trash2 size={18} /></button>
              </div>
            ))}
            <button className="btn ghost" onClick={() => setE('otherEquipment', [...e.otherEquipment, { id: uid(), name: 'Hevebox', watt: 100, minutes: 60, powerFactorPercent: 50 }])}><Plus size={16} /> Legg til utstyr</button>
          </Card>

          <Card title="Målt forbruk" icon={Gauge}>
            <Toggle label="Bruk faktisk målt strømforbruk" hint="F.eks. fra strømmåler-app eller måleplugg. Erstatter estimatet." checked={e.useMeasured} onChange={(v) => setE('useMeasured', v)} />
            {e.useMeasured && <div className="form-grid"><NumberField label="Målt forbruk" value={e.measuredKwh} onChange={(v) => setE('measuredKwh', v)} suffix="kWh" max={100} /></div>}
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
                Billigst å bake: <strong>{formatTime(window.start, f.locale)}–{formatTime(window.end, f.locale)}</strong>
                {new Date(window.start).getDate() !== new Date().getDate() && ' i morgen'} · ovnen koster {formatMoney(window.cost, f)} ({formatOre(window.avgPricePerKwh, f.locale)})
              </p>
            ) : <p className="muted small">Billigste tidspunkt krever spotpriser for resten av døgnet.</p>}
            <button className="link" onClick={() => navigate('strompriser')}>Se prisgraf og prisoppbygging →</button>
          </Card>

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
