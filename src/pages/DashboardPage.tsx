import { useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, ChartColumn, ClipboardList, Coins, Lock, Recycle, TrendingUp, Warehouse } from 'lucide-react'
import { useData, useFormat } from '../hooks/useData'
import { useFeature } from '../hooks/useFeature'
import { useCostContext } from '../hooks/useRecipeCosts'
import { useBusiness } from '../hooks/useBusiness'
import { Card, Notice, PageHeader, StatCard } from '../components/ui'
import { formatMoney, formatPercent, toLocalDateKey } from '../utils/format'
import { menuSummary } from '../utils/menu'
import { monthlyTotals, priceChangeSince, stockOverview, wasteSummary, WASTE_REASON_NAMES } from '../utils/inventory'
import { navigate } from '../hooks/useRoute'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des']
const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`

/** Enkle stolper for trender (tall er alltid skrevet ut ved siden av). */
function Bars({ rows, format }: { rows: { month: string; total: number }[]; format: (n: number) => string }) {
  const max = Math.max(...rows.map((r) => r.total), 0)
  return (
    <ul className="bars" role="list">
      {rows.map((r) => (
        <li key={r.month}>
          <span className="bar-label">{monthLabel(r.month)}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: max > 0 ? `${(r.total / max) * 100}%` : 0 }} /></span>
          <span className="bar-value">{format(r.total)}</span>
        </li>
      ))}
    </ul>
  )
}

/** Nøkkeltall for virksomheten: menyer, priser, lager, svinn og (Business Plus) trender. */
export function DashboardPage() {
  const f = useFormat()
  const { data } = useData()
  const ctx = useCostContext()
  const { profile } = useBusiness()
  const inventory = useFeature('inventory')
  const advanced = useFeature('advancedDashboard')
  // Datoene settes én gang når siden åpnes
  const [dates] = useState(() => {
    const now = Date.now()
    return { today: toLocalDateKey(new Date(now)), since90: toLocalDateKey(new Date(now - 90 * 86_400_000)), since180: toLocalDateKey(new Date(now - 180 * 86_400_000)) }
  })
  const { today, since90, since180 } = dates
  const monthStart = `${today.slice(0, 8)}01`

  const menus = useMemo(() => data.menus.map((m) => ({ menu: m, sum: menuSummary(m, ctx) })), [data.menus, ctx])
  const margins = menus.map((m) => m.sum.avgMarginPercent).filter((x): x is number => x !== null)
  const foodCosts = menus.map((m) => m.sum.avgFoodCostPercent).filter((x): x is number => x !== null)
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
  const lowMargin = menus.flatMap((m) => m.sum.items.filter((i) => i.marginPercent !== null && i.marginPercent < 20).map((i) => ({ menu: m.menu.name, ...i })))

  const priceMoves = useMemo(() => data.ingredients
    .map((i) => ({ ing: i, change: priceChangeSince(i, data.prices, since90) }))
    .filter((x): x is { ing: typeof x.ing; change: number } => x.change !== null && Math.abs(x.change) >= 1)
    .sort((a, b) => b.change - a.change)
    .slice(0, 6), [data.ingredients, data.prices, since90])

  const productionMonth = data.history.filter((h) => h.date.slice(0, 10) >= monthStart).reduce((s, h) => s + h.totalCost, 0)
  const stock = stockOverview(data.ingredients, data.stockLevels)
  const stockValue = stock.reduce((s, r) => s + r.value, 0)
  const low = stock.filter((r) => r.low)
  const waste = wasteSummary(data.waste, monthStart, today)

  const trends = useMemo(() => ({
    waste: monthlyTotals(data.waste, (w) => w.loggedAt, (w) => w.cost),
    production: monthlyTotals(data.history, (h) => h.date, (h) => h.totalCost),
    purchases: monthlyTotals(data.stockMovements.filter((m) => m.kind === 'innkjop'), (m) => m.movedAt, (m) => m.quantity * m.unitCost),
    wasteReasons: wasteSummary(data.waste, since180, today),
  }), [data.waste, data.history, data.stockMovements, today, since180])

  const money0 = (n: number) => formatMoney(n, f, 0)

  return (
    <>
      <PageHeader title="Dashboard" description={`Nøkkeltall for ${profile.productionWordPlural}, menyer, innkjøp${inventory.allowed ? ', lager og svinn' : ''}.`} />

      <div className="stats-grid">
        <StatCard label="Snittmargin i menyene" value={avg(margins) === null ? '–' : formatPercent(avg(margins), f.locale)} sub={`${data.menus.length} menyer`} icon={ClipboardList} />
        <StatCard label="Råvareandel" value={avg(foodCosts) === null ? '–' : formatPercent(avg(foodCosts), f.locale)} sub="Snitt for menyene" icon={Coins} />
        <StatCard label={`Produksjon denne måneden`} value={money0(productionMonth)} sub={`${data.history.filter((h) => h.date.slice(0, 10) >= monthStart).length} registrert`} icon={BookOpen} />
        {inventory.allowed
          ? <StatCard label="Svinn denne måneden" value={money0(waste.total)} sub={`${waste.count} registreringer`} icon={Recycle} tone={waste.total > 0 ? 'amber' : 'default'} />
          : <StatCard label="Oppskrifter" value={String(data.recipes.length)} sub={`${data.ingredients.length} ingredienser`} icon={BookOpen} />}
      </div>

      <div className="grid-2">
        <Card title="Prisendringer siste 90 dager" icon={TrendingUp}>
          {priceMoves.length === 0 ? <p className="muted">Ingen prisendringer registrert. Historikken bygges opp når prisene endres.</p> : (
            <dl className="kv">
              {priceMoves.map(({ ing, change }) => (
                <div key={ing.id} className="kv-row">
                  <dt>{ing.name}</dt>
                  <dd className={change > 0 ? 'neg' : 'pos'}>{change > 0 ? '+' : ''}{formatPercent(change, f.locale)}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="muted small">Pris per kg, liter eller stk. Nye priser brukes i kalkulasjonene, mens historikken beholder kostnadene slik de var.</p>
        </Card>

        <Card title="Retter med lav margin" icon={AlertTriangle}>
          {lowMargin.length === 0 ? <p className="muted">{data.menus.length ? 'Ingen retter under 20 % margin.' : 'Lag en meny for å se margin per rett.'}</p> : (
            <dl className="kv">
              {lowMargin.slice(0, 8).map((i) => (
                <div key={`${i.menu}-${i.item.id}`} className="kv-row">
                  <dt>{i.name} <small className="muted">({i.menu})</small></dt>
                  <dd className={(i.marginPercent ?? 0) < 0 ? 'neg' : 'warn-text'}>{formatPercent(i.marginPercent, f.locale)}</dd>
                </div>
              ))}
            </dl>
          )}
          {data.menus.length > 0 && <button className="link" onClick={() => navigate('menyer')}>Til menyene</button>}
        </Card>
      </div>

      {inventory.allowed ? (
        <div className="grid-2">
          <Card title="Lager" icon={Warehouse}>
            <dl className="kv">
              <dt>Lagerverdi</dt><dd>{money0(stockValue)}</dd>
              <dt>Under minimum</dt><dd className={low.length ? 'warn-text' : ''}>{low.length}</dd>
            </dl>
            {low.length > 0 && <p className="small">Bør bestilles: {low.slice(0, 8).map((r) => r.ingredient.name).join(', ')}{low.length > 8 ? ' …' : ''}</p>}
            <button className="link" onClick={() => navigate('lager')}>Til lageret</button>
          </Card>
          <Card title="Svinn denne måneden" icon={Recycle}>
            {waste.count === 0 ? <p className="muted">Ikke registrert noe svinn denne måneden.</p> : (
              <dl className="kv">
                {waste.byReason.slice(0, 5).map((r) => <div key={r.reason} className="kv-row"><dt>{WASTE_REASON_NAMES[r.reason]}</dt><dd>{money0(r.cost)}</dd></div>)}
              </dl>
            )}
            <button className="link" onClick={() => navigate('svinn')}>Til matsvinn</button>
          </Card>
        </div>
      ) : (
        <Notice><Lock size={14} /> Lager og matsvinn er med i Business og Business Plus.</Notice>
      )}

      {advanced.allowed ? (
        <>
          <div className="grid-2">
            <Card title="Produksjonskostnad per måned" icon={ChartColumn}><Bars rows={trends.production} format={money0} /></Card>
            <Card title="Svinn per måned" icon={Recycle}><Bars rows={trends.waste} format={money0} /></Card>
          </div>
          <div className="grid-2">
            <Card title="Innkjøp til lager per måned" icon={Warehouse}><Bars rows={trends.purchases} format={money0} /></Card>
            <Card title="Mest kastet siste 6 måneder" icon={Recycle}>
              {trends.wasteReasons.top.length === 0 ? <p className="muted">Ingen svinn registrert.</p> : (
                <dl className="kv">
                  {trends.wasteReasons.top.map((t) => <div key={t.name} className="kv-row"><dt>{t.name} ({t.count})</dt><dd>{money0(t.cost)}</dd></div>)}
                </dl>
              )}
            </Card>
          </div>
        </>
      ) : (
        <Notice><Lock size={14} /> Trender over seks måneder (produksjon, svinn og innkjøp) er med i Business Plus.</Notice>
      )}
    </>
  )
}
