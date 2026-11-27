import { useState } from 'react'
import { Barcode, ImageUp, Package, Receipt, ScanText, Sparkles } from 'lucide-react'
import { PageHeader, Notice } from '../components/ui'
import { IngredientScanPanel, ReceiptScanPanel, RecipeScanPanel } from '../components/ScanPanels'
import { handOffIngredient, handOffRecipe } from '../lib/scanHandoff'
import { navigate } from '../hooks/useRoute'
import { useAiScan } from '../hooks/useAiScan'

type Mode = 'ingrediens' | 'oppskrift' | 'kvittering' | 'opplasting'

const CHOICES: { mode: Mode; title: string; text: string; icon: typeof Barcode }[] = [
  { mode: 'ingrediens', title: 'Skann ingrediens', text: 'Strekkode eller etikett. Henter navn, pakning og allergener.', icon: Package },
  { mode: 'oppskrift', title: 'Skann oppskrift', text: 'Trykt eller håndskrevet. Blir en oppskrift du kan rette.', icon: ScanText },
  { mode: 'kvittering', title: 'Skann kvittering eller faktura', text: 'Oppdaterer innkjøpspriser etter at du har godkjent dem.', icon: Receipt },
  { mode: 'opplasting', title: 'Last opp bilde', text: 'Bruk et bilde du allerede har tatt, eller en skjermdump.', icon: ImageUp },
]

/** Samleside for skanning med mobilkamera eller bilde (iPhone, Android, nettbrett og PC). */
export function ScanPage() {
  const ai = useAiScan()
  const [mode, setMode] = useState<Mode | null>(null)
  const [upload, setUpload] = useState<Exclude<Mode, 'opplasting'> | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const close = () => { setMode(null); setUpload(null) }
  const active = upload ?? mode

  return (
    <>
      <PageHeader title="Skann" description="Bruk kameraet til å registrere ingredienser, oppskrifter og innkjøp. Du kontrollerer alltid resultatet før noe lagres." />
      {message && <Notice>{message}</Notice>}

      {!active && mode !== 'opplasting' && (
        <div className="scan-choices">
          {CHOICES.map(({ mode: m, title, text, icon: Icon }) => (
            <button key={m} className="scan-choice" onClick={() => { setMessage(null); setMode(m) }}>
              <Icon size={28} aria-hidden />
              <strong>{title}</strong>
              <span className="muted small">{text}</span>
            </button>
          ))}
        </div>
      )}

      {mode === 'opplasting' && !upload && (
        <div className="scan-choices">
          {CHOICES.filter((c) => c.mode !== 'opplasting').map(({ mode: m, title, icon: Icon }) => (
            <button key={m} className="scan-choice" onClick={() => setUpload(m as Exclude<Mode, 'opplasting'>)}>
              <Icon size={24} aria-hidden />
              <strong>{title.replace('Skann ', 'Bilde av ')}</strong>
            </button>
          ))}
          <button className="btn ghost" onClick={close}>Tilbake</button>
        </div>
      )}

      {active === 'ingrediens' && (
        <IngredientScanPanel upload={!!upload} onCancel={close} onDone={(draft, msg) => { handOffIngredient(draft, msg); navigate('ingredienser') }} />
      )}
      {active === 'oppskrift' && (
        <RecipeScanPanel upload={!!upload} onCancel={close} onDone={(r, created) => {
          handOffRecipe(r, `Oppskriften er tolket fra bildet. Kontroller ingredienser, mengder og steg før du lagrer.${created ? ` ${created} ny(e) ingrediens(er) er lagt til uten pris – oppdater prisen under Ingredienser.` : ''}`)
          navigate('oppskrifter')
        }} />
      )}
      {active === 'kvittering' && (
        <ReceiptScanPanel upload={!!upload} onClose={(msg) => { close(); if (msg) setMessage(msg) }} />
      )}

      {!active && (
        <p className="muted small">
          <Sparkles size={13} aria-hidden />{' '}
          {ai.active
            ? `AI-tolkning: ${ai.status.used} av ${ai.status.limit} skanninger brukt denne måneden. Strekkoder og tekstgjenkjenning på telefonen teller ikke.`
            : 'Tekstgjenkjenning og strekkoder kjører på telefonen. Bildene lagres ikke.'}
        </p>
      )}
    </>
  )
}
