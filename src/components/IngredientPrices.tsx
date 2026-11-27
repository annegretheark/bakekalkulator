import { useState } from 'react'
import { Plus, Trash2, TrendingUp } from 'lucide-react'
import { UNITS, type Ingredient, type PriceEntry, type Unit } from '../types'
import { useData, useFormat } from '../hooks/useData'
import { useFeature } from '../hooks/useFeature'
import { NumberField, SelectField, TextField } from './ui'
import { compareSuppliers, pricePerBaseUnit } from '../utils/inventory'
import { formatDate, formatMoney, toLocalDateKey, uid } from '../utils/format'

/**
 * Prishistorikk og sammenligning av leverandører for én ingrediens.
 * «Bruk denne prisen» gjør tilbudet til gjeldende pris for fremtidige kalkulasjoner;
 * historiske produksjonskostnader endres ikke.
 */
export function IngredientPrices({ ingredient, onUse }: { ingredient: Ingredient; onUse: (patch: Partial<Ingredient>) => void }) {
  const f = useFormat()
  const { data, addPriceOffer, deletePriceOffer } = useData()
  const feature = useFeature('inventory')
  const [offer, setOffer] = useState<PriceEntry | null>(null)
  const history = data.prices.filter((p) => p.ingredientId === ingredient.id && p.source === 'historikk').slice(0, 12)
  const offers = compareSuppliers(ingredient, data.prices, data.suppliers)
  const best = offers[0]
  const supplierName = (id: string | null) => (id ? data.suppliers.find((s) => s.id === id)?.name ?? 'Slettet leverandør' : '–')

  return (
    <details className="ocr-text" open={offers.length > 1}>
      <summary><TrendingUp size={14} aria-hidden /> Priser og leverandører ({offers.length} {offers.length === 1 ? 'pris' : 'priser'})</summary>

      {offers.length > 1 && (
        <div className="table-wrap">
          <table className="clean price-compare">
            <thead><tr><th>Leverandør</th><th className="num">Pris</th><th className="num">Per enhet</th><th>Dato</th><th /></tr></thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.entryId ?? 'current'}>
                  <td>{o.supplierName}{o.current && <span className="tag">Gjeldende</span>}{o.source === 'tilbud' && <span className="tag">Tilbud</span>}</td>
                  <td className="num">{formatMoney(o.price, f)} / {o.packageSize} {o.unit}</td>
                  <td className={`num ${o === best ? 'best' : ''}`}>{o.perBase ? `${formatMoney(o.perBase.value, f)}/${o.perBase.unit}` : '–'}</td>
                  <td>{o.pricedAt ? formatDate(o.pricedAt, f.locale) : '–'}</td>
                  <td className="row-actions">
                    {!o.current && <button className="btn ghost small" onClick={() => onUse({ supplierId: o.supplierId, price: o.price, packageSize: o.packageSize, unit: o.unit, priceUpdated: toLocalDateKey(new Date()) })}>Bruk denne prisen</button>}
                    {o.source === 'tilbud' && o.entryId && <button className="icon-btn danger" aria-label="Slett tilbud" onClick={() => deletePriceOffer(o.entryId!)}><Trash2 size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {feature.allowed && data.ingredients.some((i) => i.id === ingredient.id) && (
        offer ? (
          <div className="form-grid">
            <SelectField label="Leverandør" value={offer.supplierId ?? ''} onChange={(v) => setOffer({ ...offer, supplierId: v || null })}
              options={[{ value: '', label: '— Velg —' }, ...data.suppliers.map((s) => ({ value: s.id, label: s.name }))]} />
            <NumberField label="Pris" value={offer.price} max={10000000} onChange={(v) => setOffer({ ...offer, price: v })} suffix="kr" />
            <NumberField label="Pakning" value={offer.packageSize} min={0.001} onChange={(v) => setOffer({ ...offer, packageSize: v })} />
            <SelectField<Unit> label="Enhet" value={offer.unit} onChange={(v) => setOffer({ ...offer, unit: v })} options={UNITS.map((u) => ({ value: u, label: u }))} />
            <TextField label="Leverandørens varenummer" value={offer.supplierItemNo} onChange={(v) => setOffer({ ...offer, supplierItemNo: v })} />
            <div className="actions">
              <button className="btn primary small" disabled={!offer.supplierId || !(offer.packageSize > 0)} onClick={async () => { await addPriceOffer(offer); setOffer(null) }}>Lagre tilbud</button>
              <button className="btn ghost small" onClick={() => setOffer(null)}>Avbryt</button>
            </div>
          </div>
        ) : (
          <button className="btn ghost small" disabled={data.suppliers.length === 0} onClick={() => setOffer({
            id: uid(), ingredientId: ingredient.id, supplierId: null, supplierItemNo: '', packageSize: ingredient.packageSize, unit: ingredient.unit,
            price: 0, vatPercent: ingredient.vatPercent, pricedAt: toLocalDateKey(new Date()), source: 'tilbud',
          })}><Plus size={14} /> Legg inn pris fra annen leverandør</button>
        )
      )}
      {!feature.allowed && <p className="muted small">Sammenligning av flere leverandører per vare er med i Business og Business Plus.</p>}

      <h4 className="sub-head">Prishistorikk</h4>
      {history.length === 0 ? <p className="muted small">Ingen tidligere priser registrert ennå.</p> : (
        <ul className="plain-list">
          {history.map((h) => {
            const per = pricePerBaseUnit(h)
            return <li key={h.id}>{formatDate(h.pricedAt, f.locale)}: {formatMoney(h.price, f)} for {h.packageSize} {h.unit}{per ? ` (${formatMoney(per.value, f)}/${per.unit})` : ''} · {supplierName(h.supplierId)}</li>
          })}
        </ul>
      )}
      <p className="muted small">Nye priser brukes i alle fremtidige kalkulasjoner. Kostnader som allerede er lagret i historikken, endres ikke.</p>
    </details>
  )
}
