import { useMemo, useState } from 'react'
import type { PricedInterval } from '../utils/electricity'
import { formatDateTime, formatOre, formatTime } from '../utils/format'

interface Props {
  intervals: PricedInterval[]
  now: Date
  highlight?: { start: string; end: string } | null
  locale?: string
}

const H = 220
const PAD = { top: 12, right: 8, bottom: 28, left: 44 }

/**
 * Stolpediagram for strømpris per intervall (time eller kvarter).
 * Negative priser tegnes under nullinjen.
 * Én serie – ingen legend nødvendig; billigste bakevindu og nåværende intervall
 * markeres med egen tone og forklares med tekst under diagrammet.
 */
export function PriceChart({ intervals, now, highlight, locale = 'nb-NO' }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const W = Math.max(320, intervals.length * 10 + PAD.left + PAD.right)

  const { max, min, ticks } = useMemo(() => {
    const vals = intervals.map((i) => i.totalPerKwh)
    const hi = Math.max(0.1, ...vals)
    const lo = Math.min(0, ...vals)
    const step = niceStep((hi - lo) / 4)
    const top = Math.ceil(hi / step) * step
    const bottom = Math.floor(lo / step) * step
    const n = Math.round((top - bottom) / step)
    return { max: top, min: bottom, ticks: Array.from({ length: n + 1 }, (_, i) => Math.round((bottom + i * step) * 1e6) / 1e6) }
  }, [intervals])

  if (intervals.length === 0) return null

  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const slot = innerW / intervals.length
  const barW = Math.max(1, slot - 2) // 2px mellomrom mellom stolper
  const y = (v: number) => PAD.top + innerH - ((v - min) / (max - min)) * innerH
  const y0 = y(0)
  const t = now.getTime()
  const hs = highlight ? Date.parse(highlight.start) : NaN
  const he = highlight ? Date.parse(highlight.end) : NaN
  const hovered = hover !== null ? intervals[hover] : null

  return (
    <div className="chart">
      <div className="chart-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Strømpris per tidsintervall" onMouseLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className={v === 0 && min < 0 ? 'grid zero' : 'grid'} />
              <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" className="axis">{Math.round(v * 100)}</text>
            </g>
          ))}
          <text x={4} y={PAD.top + 2} className="axis" dominantBaseline="hanging">øre</text>
          {intervals.map((iv, i) => {
            const s = Date.parse(iv.start)
            const e = Date.parse(iv.end)
            const inWindow = s < he && e > hs
            const isNow = s <= t && t < e
            const x = PAD.left + i * slot + 1
            const yv = y(iv.totalPerKwh)
            const negative = iv.totalPerKwh < 0
            const top = Math.min(y0, yv)
            const h = Math.max(1, Math.abs(y0 - yv))
            const r = Math.min(4, barW / 2, h)
            const hour = new Date(iv.start)
            const showLabel = hour.getMinutes() === 0 && hour.getHours() % 3 === 0
            return (
              <g key={iv.start} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1}>
                <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} fill="transparent" />
                <path d={negative ? roundedBottom(x, top, barW, h, r) : roundedTop(x, top, barW, h, r)} className={`bar ${negative ? 'bar-neg' : ''} ${inWindow ? 'bar-best' : ''} ${isNow ? 'bar-now' : ''} ${hover === i ? 'bar-hover' : ''}`} />
                {showLabel && (
                  <text x={x + barW / 2} y={H - 8} textAnchor="middle" className="axis">
                    {hour.getHours() === 0 ? hour.toLocaleDateString(locale, { weekday: 'short' }) : String(hour.getHours()).padStart(2, '0')}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <div className="chart-foot">
        <span className="tooltip-line" aria-live="polite">
          {hovered
            ? <><strong>{formatDateTime(hovered.start, locale)}–{formatTime(hovered.end, locale)}</strong> · {formatOre(hovered.totalPerKwh, locale)} <span className="muted">(spot {formatOre(hovered.spotNokPerKwh, locale)} eks. mva)</span></>
            : <span className="muted">Pek på en stolpe for detaljer. Pris inkl. valgte tillegg.</span>}
        </span>
        <span className="chart-key">
          {highlight && <span><i className="key key-best" /> Billigste bakevindu</span>}
          <span><i className="key key-now" /> Nå</span>
          <button type="button" className="link" onClick={() => setShowTable((v) => !v)}>{showTable ? 'Skjul tabell' : 'Vis som tabell'}</button>
        </span>
      </div>
      {showTable && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Tidsrom</th><th className="num">Spot eks. mva</th><th className="num">Total pris</th></tr></thead>
            <tbody>
              {intervals.map((iv) => (
                <tr key={iv.start}>
                  <td>{formatDateTime(iv.start, locale)}–{formatTime(iv.end, locale)}</td>
                  <td className="num">{formatOre(iv.spotNokPerKwh, locale)}</td>
                  <td className="num">{formatOre(iv.totalPerKwh, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p
}

/** Avrundet i dataenden (nederst) for negative stolper. */
function roundedBottom(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}
