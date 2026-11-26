import { useId, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, Info } from 'lucide-react'
import { parseNumber } from '../utils/format'

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Card({ title, icon: Icon, children, className = '', actions }: { title?: string; icon?: LucideIcon; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{Icon && <Icon size={18} aria-hidden />} {title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function StatCard({ label, value, sub, icon: Icon, tone = 'default' }: { label: string; value: string; sub?: ReactNode; icon: LucideIcon; tone?: 'default' | 'green' | 'amber' | 'red' }) {
  return (
    <div className={`stat stat-${tone}`}>
      <div className="stat-icon"><Icon size={20} aria-hidden /></div>
      <div className="stat-body">
        <span className="stat-label">{label}</span>
        <strong className="stat-value">{value}</strong>
        {sub && <span className="stat-sub">{sub}</span>}
      </div>
    </div>
  )
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={36} aria-hidden />
      <h3>{title}</h3>
      <p className="muted">{text}</p>
      {action}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  const Icon = tone === 'info' ? Info : AlertTriangle
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden />
      <div>{children}</div>
    </div>
  )
}

interface NumberFieldProps {
  label: string
  value: number
  onChange: (n: number) => void
  suffix?: string
  min?: number
  max?: number
  step?: number
  hint?: string
  disabled?: boolean
  integer?: boolean
}

/**
 * Tallfelt som godtar norsk desimalkomma. Ugyldige verdier vises med feilmelding
 * og sendes ikke videre, slik at beregningene alltid får gyldige tall.
 */
export function NumberField({ label, value, onChange, suffix, min = 0, max, step, hint, disabled, integer }: NumberFieldProps) {
  const id = useId()
  const [text, setText] = useState(() => String(value).replace('.', ','))
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    if (parseNumber(text) !== value) setText(String(value).replace('.', ','))
  }

  const n = parseNumber(text)
  let error: string | null = null
  if (text.trim() === '' || Number.isNaN(n)) error = 'Skriv inn et tall'
  else if (min !== undefined && n < min) error = `Minst ${String(min).replace('.', ',')}`
  else if (max !== undefined && n > max) error = `Maks ${String(max).replace('.', ',')}`
  else if (integer && !Number.isInteger(n)) error = 'Må være et helt tall'

  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input
          id={id}
          inputMode="decimal"
          value={text}
          disabled={disabled}
          step={step}
          aria-invalid={!!error}
          aria-describedby={error || hint ? `${id}-msg` : undefined}
          onChange={(e) => {
            setText(e.target.value)
            const v = parseNumber(e.target.value)
            const ok = e.target.value.trim() !== '' && !Number.isNaN(v) && (min === undefined || v >= min) && (max === undefined || v <= max) && (!integer || Number.isInteger(v))
            if (ok) { setLastValue(v); onChange(v) }
          }}
        />
        {suffix && <span className="suffix">{suffix}</span>}
      </div>
      {(error || hint) && <small id={`${id}-msg`} className={error ? 'error' : 'muted'}>{error ?? hint}</small>}
    </div>
  )
}

export function TextField({ label, value, onChange, placeholder, required, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; type?: string }) {
  const id = useId()
  const error = required && !value.trim() ? 'Påkrevd' : null
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} />
      {error && <small className="error">{error}</small>}
    </div>
  )
}

export function SelectField<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden><span className="toggle-thumb" /></span>
      <span>
        {label}
        {hint && <small className="muted block">{hint}</small>}
      </span>
    </label>
  )
}

export function Segmented<T extends string>({ value, onChange, options, label, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; disabled?: boolean }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={disabled} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
