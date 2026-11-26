import { ExternalLink } from 'lucide-react'
import type { PriceComponent, PriceMode, PriceSettings } from '../types'
import { RATE_REFERENCES } from '../lib/defaults'
import { NumberField, Toggle } from './ui'

interface Props {
  value: PriceSettings
  onChange: (v: PriceSettings) => void
}

function ComponentEditor({ label, c, onChange, hint, source }: { label: string; c: PriceComponent; onChange: (c: PriceComponent) => void; hint?: string; source?: string }) {
  return (
    <div className={`component-editor ${c.enabled ? '' : 'disabled'}`}>
      <Toggle label={label} checked={c.enabled} onChange={(v) => onChange({ ...c, enabled: v })} hint={hint} />
      {c.enabled && (
        <div className="form-grid compact">
          <NumberField label="Sats" value={Math.round(c.krPerKwh * 10000) / 100} onChange={(v) => onChange({ ...c, krPerKwh: v / 100 })} suffix="øre/kWh" max={1000} />
          <Toggle label="Satsen er inkl. mva" checked={c.includesVat} onChange={(v) => onChange({ ...c, includesVat: v })} />
        </div>
      )}
      {source && <a className="source" href={source} target="_blank" rel="noreferrer">Kilde <ExternalLink size={12} /></a>}
    </div>
  )
}

/** Konfigurasjon av strømpris og tillegg. Alle satser kan overstyres av brukeren. */
export function PriceSettingsForm({ value: s, onChange }: Props) {
  const set = <K extends keyof PriceSettings>(k: K, v: PriceSettings[K]) => onChange({ ...s, [k]: v })
  const business = s.customerType === 'bedrift'
  const mode: PriceMode = business && s.mode === 'norgespris' ? 'spot' : s.mode

  return (
    <div className="stack">
      {business && (
        <Toggle label="Mva-registrert bedrift – trekk fra mva" checked={s.vatDeductible} onChange={(v) => set('vatDeductible', v)}
          hint={RATE_REFERENCES.business.note} />
      )}
      <div className="form-grid">
        <NumberField label="Merverdiavgift" value={s.vatRatePercent} onChange={(v) => set('vatRatePercent', v)} suffix="%" max={100} hint={business && s.vatDeductible ? 'Brukes bare til å trekke mva ut av satser du har oppgitt inkl. mva.' : RATE_REFERENCES.vat.note} />
      </div>

      {mode === 'manuell' && (
        <div className="form-grid">
          <NumberField label="Din totale strømpris" value={Math.round(s.manualTotalKrPerKwh * 10000) / 100} onChange={(v) => set('manualTotalKrPerKwh', v / 100)} suffix="øre/kWh" max={2000}
            hint="Alt inkludert: strøm, påslag, nettleie, avgifter og mva. Ingen tillegg legges på." />
        </div>
      )}
      {mode === 'norgespris' && (
        <ComponentEditor label="Norgespris" c={{ ...s.norgespris, enabled: true }} onChange={(c) => set('norgespris', { ...c, enabled: true })} hint={RATE_REFERENCES.norgespris.note} source={RATE_REFERENCES.norgespris.source} />
      )}
      {mode === 'fastpris' && (
        <ComponentEditor label="Fastpris fra avtalen" c={{ ...s.fixedPrice, enabled: true }} onChange={(c) => set('fixedPrice', { ...c, enabled: true })} hint="Energiprisen i fastprisavtalen din." />
      )}

      {mode !== 'manuell' && (
        <>
          {(mode === 'spot' || mode === 'fastpris') && (
            <ComponentEditor label="Påslag fra strømleverandør" c={s.supplierMarkup} onChange={(c) => set('supplierMarkup', c)} hint="Påslag per kWh. Fastbeløp per måned påvirker ikke kostnaden per baking." />
          )}
          <ComponentEditor label="Nettleie – variabelt energiledd" c={s.gridFee} onChange={(c) => set('gridFee', c)} hint={RATE_REFERENCES.gridFee.note} />
          <div className={`component-editor ${s.electricityTax.enabled && !s.electricityTax.includedInGridFee ? '' : 'disabled'}`}>
            <Toggle label="Elavgift" checked={s.electricityTax.enabled} onChange={(v) => set('electricityTax', { ...s.electricityTax, enabled: v })} hint={RATE_REFERENCES.electricityTax.note} />
            {s.electricityTax.enabled && (
              <>
                <Toggle label="Elavgiften er allerede inkludert i nettleien" checked={s.electricityTax.includedInGridFee} onChange={(v) => set('electricityTax', { ...s.electricityTax, includedInGridFee: v })} hint="Slå på hvis energileddet fra nettselskapet inkluderer elavgift – da legges den ikke til to ganger." />
                {!s.electricityTax.includedInGridFee && (
                  <div className="form-grid compact">
                    <NumberField label="Sats" value={Math.round(s.electricityTax.krPerKwh * 10000) / 100} onChange={(v) => set('electricityTax', { ...s.electricityTax, krPerKwh: v / 100 })} suffix="øre/kWh" max={100} />
                    <Toggle label="Satsen er inkl. mva" checked={s.electricityTax.includesVat} onChange={(v) => set('electricityTax', { ...s.electricityTax, includesVat: v })} />
                  </div>
                )}
              </>
            )}
            <a className="source" href={RATE_REFERENCES.electricityTax.source} target="_blank" rel="noreferrer">Kilde <ExternalLink size={12} /></a>
          </div>
          <ComponentEditor label="Andre avgifter per kWh" c={s.otherFees} onChange={(c) => set('otherFees', c)} hint="F.eks. Enova-påslag eller andre tillegg på fakturaen." />
          {mode === 'spot' && !business && (
            <div className={`component-editor ${s.subsidy.enabled ? '' : 'disabled'}`}>
              <Toggle label="Strømstøtte" checked={s.subsidy.enabled} onChange={(v) => set('subsidy', { ...s.subsidy, enabled: v })} hint={RATE_REFERENCES.subsidy.note} />
              {s.subsidy.enabled && (
                <div className="form-grid compact">
                  <NumberField label="Terskel (eks. mva)" value={Math.round(s.subsidy.thresholdKrPerKwhExVat * 10000) / 100} onChange={(v) => set('subsidy', { ...s.subsidy, thresholdKrPerKwhExVat: v / 100 })} suffix="øre/kWh" max={1000} />
                  <NumberField label="Dekningsgrad" value={s.subsidy.coveragePercent} onChange={(v) => set('subsidy', { ...s.subsidy, coveragePercent: v })} suffix="%" max={100} />
                </div>
              )}
              <a className="source" href={RATE_REFERENCES.subsidy.source} target="_blank" rel="noreferrer">Kilde <ExternalLink size={12} /></a>
            </div>
          )}
        </>
      )}
      <p className="muted small">Standardsatser kontrollert {RATE_REFERENCES.checked.split('-').reverse().join('.')}. Kontroller mot kildene – satsene endres jevnlig.</p>
    </div>
  )
}
