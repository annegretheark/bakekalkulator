import type { AllergenCode, AllergenMap, AllergenMark } from '../types'
import { ALLERGEN_CODES } from '../types'
import { ALLERGEN_NAMES, ALLERGEN_SHORT, ALLERGEN_STATUS_NAMES, type AllergenProfile } from '../lib/allergens'

type Choice = AllergenMark | ''

/** Registrering av de 14 allergenene for en ingrediens. Tomt valg = ukjent. */
export function AllergenEditor({ value, onChange }: { value: AllergenMap; onChange: (v: AllergenMap) => void }) {
  const set = (code: AllergenCode, mark: Choice) => {
    const next = { ...value }
    if (mark) next[code] = mark
    else delete next[code]
    onChange(next)
  }
  const unknown = ALLERGEN_CODES.filter((c) => !value[c])
  return (
    <fieldset className="allergen-editor">
      <legend>Allergener</legend>
      <div className="allergen-grid">
        {ALLERGEN_CODES.map((c) => (
          <label key={c} className="allergen-row">
            <span>{ALLERGEN_NAMES[c]}</span>
            <select value={value[c] ?? ''} onChange={(e) => set(c, e.target.value as Choice)} data-status={value[c] ?? 'ukjent'}>
              <option value="">Ukjent</option>
              <option value="ja">Inneholder</option>
              <option value="spor">Kan inneholde spor</option>
              <option value="nei">Inneholder ikke</option>
            </select>
          </label>
        ))}
      </div>
      {unknown.length > 0 && (
        <button type="button" className="btn ghost small" onClick={() => onChange({ ...value, ...Object.fromEntries(unknown.map((c) => [c, 'nei'])) })}>
          Sett de {unknown.length} ukjente til «Inneholder ikke»
        </button>
      )}
      <p className="hint">Bruk varedeklarasjonen. Det du ikke har kontrollert, bør stå som «Ukjent» – da blir retten aldri merket som fri for allergenet.</p>
    </fieldset>
  )
}

/** Kort oppsummering for tabeller: allergener som finnes, og antall ukjente. */
export function AllergenSummary({ map }: { map: AllergenMap }) {
  const contains = ALLERGEN_CODES.filter((c) => map[c] === 'ja')
  const traces = ALLERGEN_CODES.filter((c) => map[c] === 'spor')
  const unknown = ALLERGEN_CODES.filter((c) => !map[c]).length
  if (!contains.length && !traces.length && unknown === 0) return <span className="muted">Ingen</span>
  return (
    <span className="allergen-tags">
      {contains.map((c) => <span key={c} className="tag allergen-inneholder">{ALLERGEN_SHORT[c]}</span>)}
      {traces.map((c) => <span key={c} className="tag allergen-spor" title="Kan inneholde spor">{ALLERGEN_SHORT[c]} (spor)</span>)}
      {unknown > 0 && <span className="tag allergen-ukjent" title="Ikke registrert">{unknown === 14 ? 'Ikke registrert' : `${unknown} ukjent`}</span>}
    </span>
  )
}

/** Beregnet allergenstatus for en oppskrift eller rett. */
export function AllergenProfileView({ profile, compact = false }: { profile: AllergenProfile; compact?: boolean }) {
  const groups: { status: keyof typeof ALLERGEN_STATUS_NAMES; codes: AllergenCode[] }[] = (['inneholder', 'spor', 'krysskontakt', 'ukjent'] as const)
    .map((status) => ({ status, codes: ALLERGEN_CODES.filter((c) => profile[c] === status) }))
    .filter((g) => g.codes.length > 0)
  const free = ALLERGEN_CODES.filter((c) => profile[c] === 'fri')
  if (compact) {
    return (
      <span className="allergen-tags">
        {groups.flatMap((g) => g.codes.map((c) => (
          <span key={c} className={`tag allergen-${g.status}`} title={ALLERGEN_STATUS_NAMES[g.status]}>
            {ALLERGEN_SHORT[c]}{g.status === 'spor' ? ' (spor)' : g.status === 'krysskontakt' ? ' (krysskontakt)' : g.status === 'ukjent' ? '?' : ''}
          </span>
        )))}
        {groups.length === 0 && <span className="muted">Ingen av de 14</span>}
      </span>
    )
  }
  return (
    <dl className="allergen-profile">
      {groups.map((g) => (
        <div key={g.status}>
          <dt>{ALLERGEN_STATUS_NAMES[g.status]}</dt>
          <dd><span className="allergen-tags">{g.codes.map((c) => <span key={c} className={`tag allergen-${g.status}`}>{ALLERGEN_NAMES[c]}</span>)}</span></dd>
        </div>
      ))}
      {free.length > 0 && (
        <div>
          <dt>Inneholder ikke</dt>
          <dd className="muted">{free.map((c) => ALLERGEN_SHORT[c]).join(', ')}</dd>
        </div>
      )}
    </dl>
  )
}
