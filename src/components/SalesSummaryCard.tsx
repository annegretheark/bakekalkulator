import { BadgePercent, Lock } from 'lucide-react'
import type { SalesDraft } from '../context/dataContext'
import { useFormat } from '../hooks/useData'
import { navigate } from '../hooks/useRoute'
import { calculateSales } from '../utils/sales'
import { formatMoney, formatPercent } from '../utils/format'
import { Card, Notice, NumberField, Toggle } from './ui'

interface Props {
  sales: SalesDraft
  onChange: (s: SalesDraft) => void
  units: number
  ingredientCost: number
  electricityCost: number
  /** Planen gir tilgang til salgsberegning (Plus/Pro, eller lokal modus). */
  allowed: boolean
  loggedIn: boolean
}

/**
 * Pris og fortjeneste for bedrifter, direkte i kalkulatoren. Bruker kostnadene
 * kalkulatoren allerede har beregnet og samme regnemotor som «Salg og fortjeneste».
 */
export function SalesSummaryCard({ sales, onChange, units, ingredientCost, electricityCost, allowed, loggedIn }: Props) {
  const f = useFormat()
  const set = <K extends keyof SalesDraft>(k: K, v: SalesDraft[K]) => onChange({ ...sales, [k]: v })

  if (!allowed) {
    return (
      <Card title="Pris og fortjeneste" icon={BadgePercent}>
        <Notice>
          <Lock size={14} /> Beregning av utsalgspris, fortjeneste og margin er med i Plus og Pro.{' '}
          {loggedIn
            ? <button className="link" onClick={() => navigate('konto')}>Se abonnement</button>
            : <><button className="link" onClick={() => navigate('registrer')}>Opprett konto</button> og prøv Pro gratis i 30 dager.</>}
        </Notice>
      </Card>
    )
  }

  const r = calculateSales({
    units, ingredientCost, electricityCost,
    packagingPerUnit: sales.packagingPerUnit, laborHours: sales.laborHours, hourlyRate: sales.hourlyRate,
    transport: 0, wastePercent: 0, otherCosts: 0,
    pricePerUnit: sales.pricePerUnit, priceIncludesVat: sales.priceIncludesVat, vatRatePercent: sales.vatRatePercent,
    targetMarginPercent: sales.targetMarginPercent,
  })
  const hasPrice = sales.pricePerUnit > 0
  const priceLabel = sales.priceIncludesVat ? 'inkl. mva' : 'eks. mva'

  return (
    <Card title="Pris og fortjeneste" icon={BadgePercent}>
      <div className="form-grid">
        <NumberField label={`Utsalgspris per stk (${priceLabel})`} value={sales.pricePerUnit} onChange={(v) => set('pricePerUnit', v)} suffix="kr" />
        <NumberField label="Ønsket fortjenestemargin" value={sales.targetMarginPercent} max={99} onChange={(v) => set('targetMarginPercent', v)} suffix="%" />
        <NumberField label="Emballasje per stk" value={sales.packagingPerUnit} onChange={(v) => set('packagingPerUnit', v)} suffix="kr" />
        <NumberField label="Arbeidstid" value={sales.laborHours} max={1000} onChange={(v) => set('laborHours', v)} suffix="timer" />
        <NumberField label="Timepris" value={sales.hourlyRate} onChange={(v) => set('hourlyRate', v)} suffix="kr/t" />
        <NumberField label="Mva på salg" value={sales.vatRatePercent} max={100} onChange={(v) => set('vatRatePercent', v)} suffix="%"
          hint="Næringsmidler har normalt redusert sats. 0 hvis ikke mva-registrert. Kontroller hos Skatteetaten." />
      </div>
      <Toggle label="Utsalgsprisen er inkl. mva" checked={sales.priceIncludesVat} onChange={(v) => set('priceIncludesVat', v)} />

      <dl className="kv">
        <dt>Kostnad totalt ({units} stk)</dt><dd>{formatMoney(r.totalCost, f)}</dd>
        <dt>Kostnad per stk</dt><dd>{formatMoney(r.costPerSoldUnit, f)}</dd>
        <dt><strong>Anbefalt pris ({sales.targetMarginPercent} % margin)</strong></dt>
        <dd><strong>{formatMoney(r.recommendedPriceInclVat, f)}</strong> <small className="muted">({formatMoney(r.recommendedPriceExVat, f)} eks. mva)</small></dd>
        {hasPrice && <>
          <dt>Fortjeneste ({units} stk)</dt><dd className={r.profit >= 0 ? 'pos' : 'neg'}><strong>{formatMoney(r.profit, f)}</strong></dd>
          <dt>Fortjeneste per stk</dt><dd className={r.profit >= 0 ? 'pos' : 'neg'}>{formatMoney(units > 0 ? r.profit / units : null, f)}</dd>
          <dt>Fortjenestemargin</dt><dd>{formatPercent(r.marginPercent, f.locale)}</dd>
          <dt>Påslag</dt><dd>{formatPercent(r.markupPercent, f.locale)}</dd>
        </>}
      </dl>
      {!hasPrice && <p className="muted small">Fyll inn utsalgspris for å se fortjeneste, margin og påslag.</p>}
      {hasPrice && r.profit < 0 && <Notice tone="warn">Med denne prisen taper du {formatMoney(-r.profit, f)} på {units} stk.</Notice>}
      <p className="muted small">Margin = fortjeneste ÷ pris. Påslag = fortjeneste ÷ kostnad. Beløp eks. mva.</p>
      <button className="link" onClick={() => navigate('salg')}>Full kalkyle med svinn, transport og lagring →</button>
    </Card>
  )
}
