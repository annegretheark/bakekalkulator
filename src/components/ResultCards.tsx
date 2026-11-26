import { Coins, PiggyBank, ShoppingBasket, Wallet, Zap, Croissant } from 'lucide-react'
import type { BakeResult } from '../utils/bake'
import { formatKwh, formatMoney, formatOre } from '../utils/format'
import { useFormat } from '../hooks/useData'
import { StatCard } from './ui'

export function ResultCards({ result, pricePerKwh, priceSource, count }: { result: BakeResult; pricePerKwh: number; priceSource: string; count: number }) {
  const f = useFormat()
  const s = result.savings
  return (
    <div className="stats-grid">
      <StatCard icon={Zap} label="Strømforbruk" value={formatKwh(result.energy.totalKwh, f.locale)} sub={result.energy.measured ? 'Målt forbruk' : 'Estimert'} />
      <StatCard icon={Coins} label="Strømkostnad" value={formatMoney(result.electricityCost, f)} sub={`${formatOre(pricePerKwh, f.locale)} · ${priceSource}`} />
      <StatCard icon={ShoppingBasket} label="Ingredienser" value={formatMoney(result.ingredientCost, f)} sub={result.missingIngredientCosts ? `${result.missingIngredientCosts} linje(r) uten pris` : result.ingredientLines.length ? `${result.ingredientLines.length} ingredienser` : 'Ingen oppskrift valgt'} tone={result.missingIngredientCosts ? 'amber' : 'default'} />
      <StatCard icon={Wallet} label="Total bakekostnad" value={formatMoney(result.totalCost, f)} sub={`${count} stk`} />
      <StatCard icon={Croissant} label="Kostnad per stk" value={formatMoney(result.costPerItem, f)} tone="green" />
      <StatCard
        icon={PiggyBank}
        label="Besparelse vs. butikk"
        value={s ? formatMoney(s.perBake, f) : '–'}
        tone={s ? (s.perBake >= 0 ? 'green' : 'red') : 'default'}
        sub={s ? <>{formatMoney(s.perMonth, f, 0)}/mnd · {formatMoney(s.perYear, f, 0)}/år</> : 'Angi butikkpris for å se besparelse'}
      />
    </div>
  )
}
