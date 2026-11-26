import { useMemo, useState } from 'react'
import { BadgePercent, Calculator, Coins, Info, Package, Save, Target, TrendingUp } from 'lucide-react'
import type { SalesInput } from '../types'
import { useData, useFormat } from '../hooks/useData'
import { useBakeResult } from '../hooks/useBakeResult'
import { Card, Notice, NumberField, PageHeader, StatCard, Toggle } from '../components/ui'
import { calculateSales } from '../utils/sales'
import { formatMoney, formatNumber, formatPercent, uid } from '../utils/format'
import { useAuth } from '../hooks/useAuth'
import { canUse } from '../lib/plans'
import { navigate } from '../hooks/useRoute'

export function SalesPage() {
  const f = useFormat()
  const { draft, addLog } = useData()
  const auth = useAuth()
  // Salg krever Plus/Pro. Håndheves i databasen; her vises det bare i grensesnittet.
  const salesAllowed = !auth.configured || canUse(auth.plan, 'salesCalculator')
  const { result, pricePerKwh } = useBakeResult()
  const [saved, setSaved] = useState(false)
  const [input, setInput] = useState<SalesInput>(() => ({
    units: draft.count,
    ingredientCost: Math.round(result.ingredientCost * 100) / 100,
    electricityCost: Math.round(result.electricityCost * 100) / 100,
    packagingPerUnit: 3,
    laborHours: 1,
    hourlyRate: 250,
    transport: 0,
    wastePercent: 5,
    otherCosts: 0,
    pricePerUnit: 89,
    priceIncludesVat: true,
    vatRatePercent: 15,
    targetMarginPercent: 30,
  }))
  const set = <K extends keyof SalesInput>(k: K, v: SalesInput[K]) => setInput((i) => ({ ...i, [k]: v }))
  const r = useMemo(() => calculateSales(input), [input])

  const fillFromCalculator = () => setInput((i) => ({
    ...i, units: draft.count,
    ingredientCost: Math.round(result.ingredientCost * 100) / 100,
    electricityCost: Math.round(result.electricityCost * 100) / 100,
  }))

  const saveToHistory = async () => {
    const totalCost = r.totalCost
    await addLog({
      id: uid(), date: new Date().toISOString(), recipeId: draft.recipeId, recipeName: draft.name || 'Salgsbakst', type: draft.type,
      count: input.units, kwh: result.energy.totalKwh, pricePerKwh, electricityCost: input.electricityCost, ingredientCost: input.ingredientCost,
      totalCost, costPerItem: input.units > 0 ? totalCost / input.units : 0, storePricePerItem: 0,
      revenue: r.revenueExVat, profit: r.profit, note: 'Fra salgskalkulator (inkl. emballasje, arbeid, transport og andre kostnader)',
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <>
      <PageHeader title="Salg og fortjeneste" description="For hjemmebakere, bakerier og småskalaprodusenter. Alle beløp regnes eks. mva."
        actions={<>
          <button className="btn ghost" onClick={fillFromCalculator}><Calculator size={16} /> Hent fra kalkulator</button>
          <button className="btn primary" onClick={saveToHistory} disabled={input.units <= 0 || !salesAllowed}><Save size={16} /> {saved ? 'Lagret' : 'Lagre i historikk'}</button>
        </>} />

      {!salesAllowed && <Notice tone="warn">Lagring av salg og fortjeneste krever Plus eller Pro. Du kan fortsatt regne på priser. <button className="link" onClick={() => navigate('konto')}>Se abonnement</button></Notice>}

      <div className="stats-grid">
        <StatCard icon={Coins} label="Total kostnad" value={formatMoney(r.totalCost, f)} sub={`${formatMoney(r.costPerSoldUnit, f)} per solgte stk`} />
        <StatCard icon={TrendingUp} label="Fortjeneste" value={formatMoney(r.profit, f)} tone={r.profit >= 0 ? 'green' : 'red'} sub={`Omsetning ${formatMoney(r.revenueExVat, f)} eks. mva`} />
        <StatCard icon={BadgePercent} label="Fortjenestemargin" value={formatPercent(r.marginPercent, f.locale)} sub="Fortjeneste ÷ omsetning" />
        <StatCard icon={BadgePercent} label="Påslag" value={formatPercent(r.markupPercent, f.locale)} sub="Fortjeneste ÷ kostnad" />
        <StatCard icon={Target} label={`Anbefalt pris (${input.targetMarginPercent} % margin)`} tone="green" value={formatMoney(r.recommendedPriceInclVat, f)} sub={`${formatMoney(r.recommendedPriceExVat, f)} eks. mva`} />
      </div>

      <div className="grid-2">
        <div className="stack">
          <Card title="Produksjon og råvarer" icon={Package}>
            <div className="form-grid">
              <NumberField label="Antall produsert" value={input.units} integer min={1} onChange={(v) => set('units', v)} suffix="stk" />
              <NumberField label="Svinn" value={input.wastePercent} max={100} onChange={(v) => set('wastePercent', v)} suffix="%" hint={`${formatNumber(r.soldUnits, 1, f.locale)} stk regnes som solgt`} />
              <NumberField label="Ingredienser" value={input.ingredientCost} onChange={(v) => set('ingredientCost', v)} suffix="kr" />
              <NumberField label="Strøm" min={-100000} value={input.electricityCost} onChange={(v) => set('electricityCost', v)} suffix="kr" />
              <NumberField label="Emballasje per stk" value={input.packagingPerUnit} onChange={(v) => set('packagingPerUnit', v)} suffix="kr" />
            </div>
          </Card>
          <Card title="Arbeid og andre kostnader" icon={Coins}>
            <div className="form-grid">
              <NumberField label="Arbeidstid" value={input.laborHours} max={1000} onChange={(v) => set('laborHours', v)} suffix="timer" />
              <NumberField label="Timepris" value={input.hourlyRate} onChange={(v) => set('hourlyRate', v)} suffix="kr/t" />
              <NumberField label="Transport" value={input.transport} onChange={(v) => set('transport', v)} suffix="kr" />
              <NumberField label="Andre kostnader" value={input.otherCosts} onChange={(v) => set('otherCosts', v)} suffix="kr" hint="Markedsplass, gebyrer, utstyr o.l." />
            </div>
          </Card>
        </div>
        <div className="stack">
          <Card title="Pris og mva" icon={Target}>
            <div className="form-grid">
              <NumberField label="Utsalgspris per stk" value={input.pricePerUnit} onChange={(v) => set('pricePerUnit', v)} suffix="kr" />
              <NumberField label="Mva-sats" value={input.vatRatePercent} max={100} onChange={(v) => set('vatRatePercent', v)} suffix="%" hint="Næringsmidler har normalt redusert sats. Sett 0 hvis du ikke er mva-registrert. Kontroller hos Skatteetaten." />
              <NumberField label="Ønsket fortjenestemargin" value={input.targetMarginPercent} max={99} onChange={(v) => set('targetMarginPercent', v)} suffix="%" />
            </div>
            <Toggle label="Utsalgsprisen er inkl. mva" checked={input.priceIncludesVat} onChange={(v) => set('priceIncludesVat', v)} />
            <dl className="kv">
              <dt>Pris eks. mva</dt><dd>{formatMoney(r.priceExVat, f)}</dd>
              <dt>Mva å betale (av solgte)</dt><dd>{formatMoney(r.vatAmount, f)}</dd>
              <dt>Nullpunktspris eks. mva</dt><dd>{formatMoney(r.breakEvenPriceExVat, f)}</dd>
            </dl>
          </Card>
          <Card title="Margin eller påslag?" icon={Info}>
            <p><strong>Fortjenestemargin</strong> er fortjenesten som andel av salgsprisen: (pris − kostnad) ÷ pris.</p>
            <p><strong>Påslag</strong> er fortjenesten som andel av kostnaden: (pris − kostnad) ÷ kostnad.</p>
            <p className="muted small">Eksempel: kostnad 75 kr, pris 100 kr → margin 25 %, påslag 33,3 %. Anbefalt pris = kostnad ÷ (1 − ønsket margin).</p>
            {r.profit < 0 && <Notice tone="warn">Med dagens pris taper du {formatMoney(-r.profit, f)} på denne produksjonen.</Notice>}
          </Card>
        </div>
      </div>
    </>
  )
}
