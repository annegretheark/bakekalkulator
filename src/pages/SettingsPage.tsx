import { useRef, useState } from 'react'
import { Database, Download, Globe, Repeat, RotateCcw, Sparkles, Upload, Zap } from 'lucide-react'
import type { AppData } from '../types'
import { useData } from '../hooks/useData'
import { Card, Notice, NumberField, PageHeader, SelectField } from '../components/ui'
import { emptyData, seedData } from '../lib/seed'
import { SUPPORTED_LOCALES } from '../locales'
import { useAuth } from '../hooks/useAuth'
import { PLAN_NAMES } from '../lib/plans'
import { navigate } from '../hooks/useRoute'

export function SettingsPage() {
  const { data, saveSettings, replaceAll } = useData()
  const s = data.settings
  const auth = useAuth()
  const cloud = !!auth.user && !!auth.activeOrg
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `bakekalkulator-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importData = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<AppData>
      if (!parsed || !Array.isArray(parsed.recipes) || !Array.isArray(parsed.ingredients)) throw new Error('Filen mangler oppskrifter eller ingredienser.')
      if (!confirm('Importen erstatter alle nåværende data. Fortsette?')) return
      await replaceAll(parsed as AppData)
      setMsg({ tone: 'info', text: 'Data importert.' })
    } catch (e) {
      setMsg({ tone: 'error', text: `Kunne ikke importere: ${e instanceof Error ? e.message : 'ugyldig fil'}` })
    }
  }

  return (
    <>
      <PageHeader title="Innstillinger" description="Tilpass beregningene og administrer dataene dine." />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="grid-2">
        <div className="stack">
          <Card title="Bakefrekvens" icon={Repeat}>
            <div className="form-grid">
              <NumberField label="Antall bakinger per måned" value={s.bakesPerMonth} max={100} onChange={(v) => saveSettings({ ...s, bakesPerMonth: v })} hint="Brukes til månedlig og årlig besparelse." />
            </div>
          </Card>
          <Card title="Strømpris" icon={Zap}>
            <p className="muted">Prisområde, avtaletype, nettleie, påslag, avgifter og strømstøtte stilles inn under Strømpriser.</p>
            <div className="form-grid">
              <NumberField label="Reservepris når spotpris mangler" min={-1000} value={Math.round(s.price.manualTotalKrPerKwh * 10000) / 100} onChange={(v) => saveSettings({ ...s, price: { ...s.price, manualTotalKrPerKwh: v / 100 } })} suffix="øre/kWh"
                hint="Totalpris inkl. alt. Brukes også i modusen «Manuell pris»." />
            </div>
            <button className="btn ghost" onClick={() => navigate('strompriser')}>Gå til strømpriser</button>
          </Card>
          <Card title="Språk og valuta" icon={Globe}>
            <div className="form-grid">
              <SelectField label="Språk" value={s.locale} onChange={(v) => saveSettings({ ...s, locale: v })} options={SUPPORTED_LOCALES.map((l) => ({ value: l, label: l === 'nb-NO' ? 'Norsk (bokmål)' : l }))} />
              <SelectField label="Valuta" value={s.currency} onChange={(v) => saveSettings({ ...s, currency: v })} options={[{ value: 'NOK', label: 'Norske kroner (NOK)' }]} />
            </div>
            <p className="muted small">Flere språk og valutaer kommer. Strømpriser hentes foreløpig kun for norske prisområder.</p>
          </Card>
        </div>
        <div className="stack">
          {cloud ? (
            <Card title="Data" icon={Database}>
              <p className="muted">Dataene lagres i kontoen din ({auth.activeOrg?.name}) og er tilgjengelige på alle enheter.</p>
              <p className="muted small">Eksport av egne data, import av lokale data og sletting av konto finner du under Konto.</p>
              <button className="btn ghost" onClick={() => navigate('konto')}><Database size={16} /> Gå til Konto</button>
            </Card>
          ) : (
            <Card title="Data" icon={Database}>
              <p className="muted">Dataene lagres lokalt i nettleseren på denne enheten. Ta sikkerhetskopi jevnlig{auth.configured ? ', eller logg inn for å lagre i skyen' : ''}.</p>
              <div className="actions wrap">
                <button className="btn ghost" onClick={exportData}><Download size={16} /> Eksporter</button>
                <button className="btn ghost" onClick={() => fileRef.current?.click()}><Upload size={16} /> Importer</button>
                <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) importData(file); e.target.value = '' }} />
              </div>
              <div className="actions wrap">
                <button className="btn ghost" onClick={() => confirm('Erstatte alle data med eksempeldata?') && replaceAll(seedData())}><Sparkles size={16} /> Last inn eksempeldata</button>
                <button className="btn danger" onClick={() => confirm('Slette alle oppskrifter, ingredienser og historikk? Dette kan ikke angres.') && replaceAll({ ...emptyData(), settings: s })}><RotateCcw size={16} /> Slett alle data</button>
              </div>
            </Card>
          )}
          <Card title="Abonnement" icon={Sparkles}>
            {cloud ? (
              <>
                <p><span className="pill">{PLAN_NAMES[auth.plan]}</span></p>
                <button className="link" onClick={() => navigate('konto')}>Se abonnement og prøveperiode →</button>
              </>
            ) : auth.configured ? (
              <p className="muted small">Uten innlogging lagres alt lokalt. <button className="link" onClick={() => navigate('registrer')}>Opprett konto</button> og få 30 dager Pro gratis.</p>
            ) : (
              <p className="muted small">Lokal modus – alle funksjoner er tilgjengelige.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
