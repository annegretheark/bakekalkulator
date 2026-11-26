import { useMemo } from 'react'
import { ChartColumn, Clock, ExternalLink, Landmark, Loader2, Receipt, RefreshCw, SlidersHorizontal, Zap } from 'lucide-react'
import { PRICE_AREAS, type CustomerType, type PriceArea, type PriceMode } from '../types'
import { useData, useFormat, useT } from '../hooks/useData'
import { useCheapestWindow, usePriceData } from '../hooks/usePriceData'
import { Card, EmptyState, Notice, PageHeader, Segmented, SelectField, StatCard } from '../components/ui'
import { PriceChart } from '../components/PriceChart'
import { PriceSettingsForm } from '../components/PriceSettingsForm'
import { AREA_NAMES } from '../lib/defaults'
import { calculatePrice, effectiveMode, intervalMinutes, priceIntervals } from '../utils/electricity'
import { formatMoney, formatOre, formatTime } from '../utils/format'
import { useAuth } from '../hooks/useAuth'
import { isTariffActive } from '../utils/tariffs'
import { withCustomerType } from '../utils/priceSettings'
import { osloDateKey } from '../services/priceApi'

export function PricesPage() {
  const t = useT()
  const f = useFormat()
  const { data, draft, saveSettings } = useData()
  const prices = usePriceData()
  const { window } = useCheapestWindow(draft.energy)
  const ps = data.settings.price
  const setPrice = (p: typeof ps) => saveSettings({ ...data.settings, price: p })
  // Beregninger bruker oppsettet etter at gjeldende offentlige satser er lagt inn
  const eff = prices.effectiveSettings
  const { activeOrg } = useAuth()
  const readOnly = activeOrg?.role === 'member'
  const today = osloDateKey(prices.now)

  const currentSpot = prices.current?.spotNokPerKwh ?? null
  const breakdown = useMemo(() => calculatePrice(eff, currentSpot), [eff, currentSpot])
  const resolution = prices.today.intervals[0] ? intervalMinutes(prices.today.intervals[0]) : null
  const business = ps.customerType === 'bedrift'
  const selectedMode = effectiveMode(ps)
  const mode = effectiveMode(eff)
  const isSpot = mode === 'spot'
  const modes: PriceMode[] = business ? ['spot', 'fastpris', 'manuell'] : ['spot', 'norgespris', 'fastpris', 'manuell']
  // Ved fast pris vises spotpris med samme tillegg som sammenligning
  const chartIntervals = useMemo(
    () => (isSpot ? prices.priced : priceIntervals(prices.priced, { ...eff, mode: 'spot' })),
    [isSpot, prices.priced, eff],
  )
  const upcoming = prices.priced.filter((p) => Date.parse(p.end) > prices.now.getTime())
  const minToday = prices.priced.length ? prices.priced.reduce((a, b) => (b.totalPerKwh < a.totalPerKwh ? b : a)) : null

  const rows: [string, number, boolean][] = [
    [mode === 'spot' ? 'Spotpris' : mode === 'norgespris' ? 'Norgespris' : mode === 'fastpris' ? 'Fastpris' : 'Manuell totalpris', breakdown.energy, true],
    ['Påslag', breakdown.supplierMarkup, breakdown.supplierMarkup !== 0],
    ['Nettleie (energiledd)', breakdown.gridFee, eff.gridFee.enabled],
    ['Elavgift', breakdown.electricityTax, breakdown.electricityTax !== 0],
    ['Andre avgifter', breakdown.otherFees, eff.otherFees.enabled],
    [business && eff.vatDeductible ? 'Mva (trekkes fra)' : `Mva (${eff.vatRatePercent} %)`, breakdown.vat, mode !== 'manuell' && !(business && eff.vatDeductible)],
    ['Strømstøtte', breakdown.subsidy, breakdown.subsidy !== 0],
  ]

  return (
    <>
      <PageHeader
        title="Strømpriser"
        description="Spotpriser fra hvakosterstrommen.no. Velg prisområde og avtale, og legg inn tilleggene fra fakturaen din."
        actions={<button className="btn ghost" onClick={prices.reload}><RefreshCw size={16} /> Oppdater</button>}
      />

      <Card>
        <div className="form-grid">
          <SelectField<PriceArea> label="Prisområde" value={ps.area} onChange={(v) => setPrice({ ...ps, area: v, vatRatePercent: business ? ps.vatRatePercent : v === 'NO4' ? 0 : ps.area === 'NO4' ? 25 : ps.vatRatePercent })}
            options={PRICE_AREAS.map((a) => ({ value: a, label: `${a} – ${AREA_NAMES[a]}` }))} />
          <div className="field">
            <span className="label">Kundetype</span>
            <Segmented<CustomerType> label="Kundetype" value={ps.customerType}
              onChange={(v) => setPrice(withCustomerType(ps, v))}
              options={(['bedrift', 'privat'] as CustomerType[]).map((c) => ({ value: c, label: t(`customerType.${c}`) }))} />
            <small className="muted">{business ? `Ingen Norgespris eller strømstøtte.${ps.vatDeductible ? ' Kostnad vises eks. mva.' : ''}` : 'Husholdning: inkl. mva, med strømstøtte eller Norgespris.'}</small>
          </div>
          <div className="field">
            <span className="label">Strømavtale</span>
            <Segmented<PriceMode> label="Strømavtale" value={selectedMode} onChange={(v) => setPrice({ ...ps, mode: v })}
              options={modes.map((m) => ({ value: m, label: t(`priceMode.${m}`) }))} />
          </div>
        </div>
      </Card>

      <div className="stats-grid">
        <StatCard icon={Zap} label="Pris nå" value={formatOre(prices.currentTotal, f.locale)} sub={prices.current ? `${formatTime(prices.current.start, f.locale)}–${formatTime(prices.current.end, f.locale)}` : isSpot ? 'Ingen spotpris' : t(`priceMode.${mode}`)} />
        <StatCard icon={ChartColumn} label="Dagens snitt" value={formatOre(prices.todayAverage, f.locale)} sub={resolution ? (resolution === 15 ? 'Kvarterspriser' : 'Timespriser') : undefined} />
        <StatCard icon={Clock} label="Billigste bakestart" tone="green" value={!isSpot ? 'Når som helst' : window ? formatTime(window.start, f.locale) : '–'} sub={window ? `Ovnen: ${formatMoney(window.cost, f)}` : 'Ikke nok prisdata'} />
        <StatCard icon={Receipt} label="Laveste pris" value={minToday ? formatOre(minToday.totalPerKwh, f.locale) : '–'} sub={minToday ? formatTime(minToday.start, f.locale) : undefined} />
      </div>

      {readOnly && <Notice>Du er medlem i {activeOrg?.name}. Bare eier eller administrator kan endre strømoppsettet.</Notice>}
      {prices.tariffWarnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
      {!isSpot && <Notice>Med {t(`priceMode.${mode}`).toLowerCase()} er prisen lik hele døgnet. Grafen viser likevel spotprisen med dine tillegg for sammenligning.</Notice>}
      {prices.today.error && <Notice tone="error">I dag: {prices.today.error} Du kan bruke manuell pris i mellomtiden.</Notice>}
      {prices.tomorrow.notPublished && <Notice>Morgendagens priser publiseres vanligvis rundt kl. 13. Billigste tidspunkt beregnes ut fra prisene som er kjent nå.</Notice>}
      {prices.tomorrow.error && !prices.tomorrow.notPublished && <Notice tone="warn">I morgen: {prices.tomorrow.error}</Notice>}

      <Card title={`Prisutvikling – ${ps.area} ${AREA_NAMES[ps.area]}`} icon={ChartColumn}>
        {prices.loading && prices.priced.length === 0
          ? <div className="loading"><Loader2 className="spin" /> Henter strømpriser …</div>
          : upcoming.length
            ? <PriceChart intervals={chartIntervals} now={prices.now} highlight={isSpot ? window : null} locale={f.locale} />
            : <EmptyState icon={Zap} title="Ingen priser tilgjengelig" text="Vi fikk ikke hentet spotpriser. Prøv igjen senere, eller velg «Manuell pris»." action={<button className="btn ghost" onClick={prices.reload}><RefreshCw size={16} /> Prøv igjen</button>} />}
        {isSpot && window && (
          <p className="callout">
            Basert på kalkulatoren ({draft.energy.preheatMinutes} min forvarming + {draft.energy.bakeMinutes * draft.energy.rounds} min steking):
            start <strong>{formatTime(window.start, f.locale)}</strong>, ferdig {formatTime(window.end, f.locale)}. Snittpris {formatOre(window.avgPricePerKwh, f.locale)}.
          </p>
        )}
      </Card>

      <div className="grid-2">
        <Card title="Prisoppbygging nå" icon={Receipt}>
          <table className="clean">
            <tbody>
              {rows.map(([label, v, included]) => (
                <tr key={label} className={included ? '' : 'excluded'}>
                  <td>{label}{!included && <small className="muted"> – ikke inkludert</small>}</td>
                  <td className="num">{included ? formatOre(v, f.locale) : '–'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Totalt per kWh</td><td className="num">{formatOre(breakdown.total, f.locale)}</td></tr></tfoot>
          </table>
          <p className="muted small">Alle tillegg regnes om til beløp eks. mva, og mva legges på én gang. Slik unngås dobbel mva.</p>
          {breakdown.notes.map((n) => <p key={n} className="muted small">• {n}</p>)}
        </Card>
        <Card title="Tillegg og avgifter" icon={SlidersHorizontal}>
          <PriceSettingsForm value={ps} effective={eff} onChange={setPrice} />
        </Card>
      </div>

      <Card title="Offentlige satser" icon={Landmark}>
        <p className="muted small">
          Satsene er datostyrte. Utløpte satser brukes ikke automatisk. Kilde: {prices.tariffSource === 'database' ? 'databasen (vedlikeholdes av systemeier)' : 'lokal kopi i appen'}.
          {ps.officialRates === 'manual' && ' Du bruker egne satser – offentlige satser legges ikke inn automatisk.'}
        </p>
        <div className="table-wrap">
          <table className="clean responsive">
            <thead><tr><th>Sats</th><th className="num">Verdi</th><th>Gyldig</th><th>Verifisert</th><th>Status</th><th>Kilde</th></tr></thead>
            <tbody>
              {prices.tariffs.map((tr) => {
                const active = isTariffActive(tr, today)
                const used = prices.tariffsUsed.includes(tr)
                return (
                  <tr key={tr.id ?? `${tr.code}-${tr.validFrom}`} className={active ? '' : 'excluded'}>
                    <td data-label="Sats"><strong>{tr.description}</strong>{tr.customerType && <small className="muted block">{tr.customerType === 'privat' ? 'Husholdning' : 'Bedrift'}</small>}</td>
                    <td data-label="Verdi" className="num">{tr.unit === 'prosent' ? `${tr.value} %` : formatOre(tr.value, f.locale)}</td>
                    <td data-label="Gyldig">{tr.validFrom.split('-').reverse().join('.')}–{tr.validTo ? tr.validTo.split('-').reverse().join('.') : 'inntil videre'}</td>
                    <td data-label="Verifisert">{tr.verifiedAt ? tr.verifiedAt.split('-').reverse().join('.') : 'Ikke kontrollert'}</td>
                    <td data-label="Status">{!active ? (tr.validTo && tr.validTo < today ? 'Utløpt' : 'Ikke startet') : !tr.verifiedAt ? 'Ikke kontrollert – brukes ikke' : used ? 'Brukes nå' : 'Gjeldende'}</td>
                    <td data-label="Kilde"><a href={tr.sourceUrl} target="_blank" rel="noreferrer">Kilde <ExternalLink size={12} /></a></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
