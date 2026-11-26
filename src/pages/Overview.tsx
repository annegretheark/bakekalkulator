import { ArrowRight, Calculator, Clock, Coins, Croissant, PiggyBank, TrendingUp, Wheat, Zap } from 'lucide-react'
import { useData, useFormat, useT } from '../hooks/useData'
import { useCheapestWindow, usePriceData } from '../hooks/usePriceData'
import { useBakeResult } from '../hooks/useBakeResult'
import { Card, EmptyState, PageHeader, StatCard } from '../components/ui'
import { PriceChart } from '../components/PriceChart'
import { summarize } from '../utils/stats'
import { navigate } from '../hooks/useRoute'
import { AREA_NAMES } from '../lib/defaults'
import { effectiveMode } from '../utils/electricity'
import { formatDate, formatKwh, formatMoney, formatOre, formatTime } from '../utils/format'

export function Overview() {
  const t = useT()
  const f = useFormat()
  const { data, draft } = useData()
  const prices = usePriceData()
  const { window } = useCheapestWindow(draft.energy)
  const { result } = useBakeResult()
  const s = summarize(data.history)
  const breads = data.history.filter((l) => l.type === 'brod').reduce((a, l) => a + l.count, 0)
  const area = data.settings.price.area
  const mode = effectiveMode(data.settings.price)
  const isSpot = mode === 'spot'
  const nextDay = prices.priced.filter((p) => Date.parse(p.end) > prices.now.getTime() && Date.parse(p.start) < prices.now.getTime() + 24 * 3_600_000)

  return (
    <>
      <PageHeader title="God dag, baker!" description="Her er status for bakingen din og strømprisen akkurat nå."
        actions={<button className="btn primary" onClick={() => navigate('kalkulator')}><Calculator size={18} /> Ny beregning</button>} />

      <div className="hero">
        <div>
          <span className="hero-label"><Zap size={16} /> Strømpris nå · {area} {AREA_NAMES[area]}</span>
          <strong className="hero-value">{prices.currentTotal !== null ? formatOre(prices.currentTotal, f.locale) : prices.loading ? '…' : 'Ikke tilgjengelig'}</strong>
          <span className="hero-sub">{t(`customerType.${data.settings.price.customerType}`)} · {t(`priceMode.${mode}`)} · dagens snitt {formatOre(prices.todayAverage, f.locale)}</span>
        </div>
        <div>
          <span className="hero-label"><Clock size={16} /> Billigste tidspunkt å bake</span>
          <strong className="hero-value">{!isSpot ? 'Når som helst' : window ? `${formatTime(window.start, f.locale)}–${formatTime(window.end, f.locale)}` : '–'}</strong>
          <span className="hero-sub">{window && isSpot ? `${new Date(window.start).toDateString() !== prices.now.toDateString() ? 'I morgen · ' : ''}ovnen koster ${formatMoney(window.cost, f)}` : isSpot ? 'Venter på prisdata' : 'Fast pris hele døgnet'}</span>
        </div>
        <div>
          <span className="hero-label"><Wheat size={16} /> {draft.name || 'Gjeldende beregning'}</span>
          <strong className="hero-value">{formatMoney(result.costPerItem, f)} <small>per stk</small></strong>
          <span className="hero-sub">{draft.count} stk · totalt {formatMoney(result.totalCost, f)}</span>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard icon={Croissant} label="Bakte varer totalt" value={`${s.items} stk`} sub={`${breads} brød · ${s.items - breads} andre`} />
        <StatCard icon={Zap} label="Totalt strømforbruk" value={formatKwh(s.kwh, f.locale)} sub={formatMoney(s.electricityCost, f)} />
        <StatCard icon={Coins} label="Totale bakekostnader" value={formatMoney(s.totalCost, f)} sub={`Snitt ${formatMoney(s.avgCostPerItem, f)} per stk`} />
        <StatCard icon={PiggyBank} label="Spart vs. butikk" value={formatMoney(s.savings, f)} tone={s.savings >= 0 ? 'green' : 'red'} sub={`${s.bakes} bakinger`} />
        <StatCard icon={TrendingUp} label="Salg og fortjeneste" value={s.revenue > 0 ? formatMoney(s.profit, f) : '–'} sub={s.revenue > 0 ? `Omsetning ${formatMoney(s.revenue, f)}` : 'Ingen salg registrert'} />
      </div>

      <div className="grid-2 wide-left">
        <Card title="Strømpris neste døgn" icon={Zap} actions={<button className="link" onClick={() => navigate('strompriser')}>Detaljer <ArrowRight size={14} /></button>}>
          {nextDay.length ? <PriceChart intervals={nextDay} now={prices.now} highlight={isSpot ? window : null} locale={f.locale} />
            : <p className="muted">{prices.loading ? 'Henter priser …' : 'Ingen prisdata tilgjengelig akkurat nå.'}</p>}
        </Card>
        <Card title="Siste bakinger" icon={Croissant} actions={<button className="link" onClick={() => navigate('historikk')}>Alle <ArrowRight size={14} /></button>}>
          {data.history.length === 0
            ? <EmptyState icon={Croissant} title="Ingen bakinger ennå" text="Lagre en baking fra kalkulatoren for å komme i gang." />
            : (
              <ul className="recent">
                {[...data.history].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map((l) => (
                  <li key={l.id}>
                    <span><strong>{l.recipeName}</strong><small className="muted block">{formatDate(l.date, f.locale)} · {l.count} stk</small></span>
                    <span className="num"><strong>{formatMoney(l.totalCost, f)}</strong><small className="muted block">{formatMoney(l.costPerItem, f)}/stk</small></span>
                  </li>
                ))}
              </ul>
            )}
        </Card>
      </div>
    </>
  )
}
