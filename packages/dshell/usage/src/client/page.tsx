/**
 * The usage page: one settings entry that charts what every model has cost.
 *
 * Everything on it comes from one host endpoint. `summary` reads the index,
 * `scan` extends it first — the host owns both the session events and the
 * index, so the browser asks for a rebuild rather than performing one.
 *
 * The two charts answer different questions and neither is derivable from the
 * other: the stacked area shows how the total moved over time and which route
 * moved it, and the pie shows what share each route holds across the whole
 * window. Both are hand-rolled SVG — the client bundle inlines its imports, and
 * a charting library would be the largest thing in it by an order of magnitude.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { DSHELL_USAGE_PATH } from '@nexus-aethra/dshell-std'
import type { PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { UsageResponse, UsageSummary, UsageTotalRow } from '../protocol.js'

/** A fixed palette: a route keeps its colour as the window changes. */
const PALETTE = [
  '#5B8FF9', '#61DDAA', '#F6BD16', '#7262FD', '#78D3F8',
  '#9661BC', '#F6903D', '#008685', '#F08BB4', '#E8684A',
]

const RANGES = [
  { days: 7, key: 'range.7' },
  { days: 30, key: 'range.30' },
  { days: null, key: 'range.all' },
] as const

/** Compact token counts: the axis and the table both read better rounded. */
const counts = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

/** Rough sizes; the page is a settings column, not a full viewport. */
const CURVE = { width: 720, height: 200, padLeft: 56, padRight: 12, padTop: 12, padBottom: 24 }
const PIE = { size: 200, radius: 88 }

/** Every bucket summed — the measure both charts and the table sort on. */
function total(buckets: { uncachedInputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number }): number {
  return buckets.uncachedInputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
}

/** One stacked band's outline, from the upper edge across and the lower back. */
function bandPath(upper: readonly number[], lower: readonly number[], xs: readonly number[], y: (value: number) => number): string {
  const top = upper.map((value, index) => `${index === 0 ? 'M' : 'L'}${String(xs[index])},${String(y(value))}`)
  const bottom = lower.map((value, index) => `L${String(xs[index])},${String(y(value))}`).reverse()
  return [...top, ...bottom, 'Z'].join(' ')
}

/** One pie slice. */
function slicePath(start: number, end: number): string {
  const { size, radius } = PIE
  const cx = size / 2
  const cy = size / 2
  const point = (angle: number): [number, number] => [
    cx + radius * Math.cos(angle),
    cy + radius * Math.sin(angle),
  ]
  const [x1, y1] = point(start)
  const [x2, y2] = point(end)
  const large = end - start > Math.PI ? 1 : 0
  return `M${String(cx)},${String(cy)} L${String(x1)},${String(y1)} A${String(radius)},${String(radius)} 0 ${String(large)} 1 ${String(x2)},${String(y2)} Z`
}

/** The page body. */
export function UsageSection({ t }: PropsLocale<'dshellUsage'>): ReactElement {
  const [days, setDays] = useState<number | null>(7)
  const [summary, setSummary] = useState<UsageSummary | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)

  const ask = useCallback(async (action: 'summary' | 'scan', window: number | null): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const response = await fetch(DSHELL_USAGE_PATH, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, days: window }),
      })
      const body = await response.json() as UsageResponse
      if ('error' in body) throw new Error(body.error)
      setSummary(body)
      setNote(action === 'scan' ? t('state.scanned', { sessions: String(body.daysList.length), turns: String(body.totals.reduce((sum, row) => sum + row.turns, 0)) }) : undefined)
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
    finally {
      setBusy(false)
    }
  }, [t])

  // Read on open, and again whenever the window changes: the window is a query
  // argument, not a filter over one big payload, so the index decides what the
  // page ever sees.
  useEffect(() => { void ask('summary', days) }, [ask, days])

  const curve = useMemo(() => {
    if (summary === undefined) return undefined
    const daysList = summary.daysList
    const models = summary.models
    if (daysList.length === 0 || models.length === 0) return undefined
    const xs = daysList.map((_, index) => CURVE.padLeft
      + (daysList.length === 1 ? 0 : (index * (CURVE.width - CURVE.padLeft - CURVE.padRight)) / (daysList.length - 1)))
    // Cumulative totals per day, in the pie's own order, so a route keeps one
    // position in both charts.
    const upper = new Map<string, number[]>()
    const lower = new Map<string, number[]>()
    let running = daysList.map(() => 0)
    for (const model of models) {
      const values = daysList.map((day) => summary.byDay
        .filter(row => row.day === day && `${row.provider}/${row.model}` === model)
        .reduce((sum, row) => sum + total(row), 0))
      const base = [...running]
      const top = values.map((value, index) => base[index]! + value)
      lower.set(model, base)
      upper.set(model, top)
      running = top
    }
    const max = Math.max(1, ...running)
    const y = (value: number): number => CURVE.height - CURVE.padBottom
      - (value / max) * (CURVE.height - CURVE.padTop - CURVE.padBottom)
    return { xs, y, max, models, bands: models.map((model, index) => ({
      model,
      color: PALETTE[index % PALETTE.length]!,
      path: bandPath(upper.get(model)!, lower.get(model)!, xs, y),
    })), daysList }
  }, [summary])

  const pie = useMemo(() => {
    if (summary === undefined) return undefined
    const rows: UsageTotalRow[] = [...summary.totals]
    const sum = rows.reduce((carry, row) => carry + total(row), 0)
    if (sum === 0) return undefined
    let angle = -Math.PI / 2
    return {
      sum,
      slices: rows.map((row, index) => {
        const share = total(row) / sum
        const start = angle
        const end = angle + share * Math.PI * 2
        angle = end
        return { row, color: PALETTE[index % PALETTE.length]!, share, path: slicePath(start, end) }
      }),
    }
  }, [summary])

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '4px 2px' }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{t('title')}</h2>
        <p style={{ margin: 0, opacity: 0.7, lineHeight: 1.6 }}>{t('subtitle')}</p>
      </header>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ opacity: 0.7 }}>{t('range.label')}</span>
        {RANGES.map(range => (
          <button
            key={range.key}
            type="button"
            onClick={() => { setDays(range.days) }}
            style={{
              padding: '4px 12px',
              borderRadius: 999,
              cursor: 'pointer',
              border: '1px solid currentColor',
              background: days === range.days ? 'currentColor' : 'transparent',
              color: days === range.days ? 'var(--dsh-surface, #fff)' : 'inherit',
              opacity: days === range.days ? 1 : 0.7,
            }}
          >
            {t(range.key)}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => { void ask('scan', days) }}
          style={{ marginLeft: 'auto', padding: '4px 14px', borderRadius: 6, cursor: busy ? 'default' : 'pointer' }}
        >
          {busy ? t('rebuild.busy') : t('rebuild')}
        </button>
      </div>

      {summary?.scannedAt != null && (
        <div style={{ opacity: 0.6, fontSize: 12 }}>
          {t('state.freshness', { day: summary.scannedAt })}
          {note === undefined ? '' : ` · ${note}`}
        </div>
      )}

      {error !== undefined && (
        <div style={{ color: 'var(--dsh-danger, #c0392b)', fontSize: 13 }}>{t('state.error', { reason: error })}</div>
      )}

      {summary === undefined && error === undefined && <div style={{ opacity: 0.6 }}>{t('state.loading')}</div>}

      {summary !== undefined && curve === undefined && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <strong>{t('state.empty.title')}</strong>
          <span style={{ opacity: 0.7 }}>{t('state.empty.body')}</span>
        </div>
      )}

      {curve !== undefined && (
        <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <figcaption style={{ opacity: 0.8 }}>{t('chart.curve')}</figcaption>
          <svg viewBox={`0 0 ${String(CURVE.width)} ${String(CURVE.height)}`} style={{ width: '100%', height: 'auto' }} role="img">
            {[0, 0.5, 1].map(fraction => {
              const value = curve.max * fraction
              return (
                <g key={fraction}>
                  <line
                    x1={CURVE.padLeft} x2={CURVE.width - CURVE.padRight}
                    y1={curve.y(value)} y2={curve.y(value)}
                    stroke="currentColor" strokeOpacity={0.15} strokeDasharray={fraction === 0 ? undefined : '3 3'}
                  />
                  <text x={CURVE.padLeft - 8} y={curve.y(value) + 4} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.6}>
                    {counts.format(value)}
                  </text>
                </g>
              )
            })}
            {curve.bands.map(band => (
              <path key={band.model} d={band.path} fill={band.color} fillOpacity={0.75} stroke={band.color} strokeWidth={0.5} />
            ))}
            {curve.daysList.map((day, index) => (
              index % Math.ceil(curve.daysList.length / 8) === 0
                ? (
                    <text key={day} x={curve.xs[index]} y={CURVE.height - 6} textAnchor="middle" fontSize={10} fill="currentColor" fillOpacity={0.6}>
                      {day.slice(5)}
                    </text>
                  )
                : null
            ))}
          </svg>
          <Legend models={curve.models} t={t} />
        </figure>
      )}

      {pie !== undefined && (
        <figure style={{ margin: 0, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <figcaption style={{ opacity: 0.8, alignSelf: 'flex-start' }}>{t('chart.pie')}</figcaption>
          <svg viewBox={`0 0 ${String(PIE.size)} ${String(PIE.size)}`} style={{ width: PIE.size, height: PIE.size }} role="img">
            {pie.slices.map(slice => (
              <path key={`${slice.row.provider}/${slice.row.model}`} d={slice.path} fill={slice.color} fillOpacity={0.85} />
            ))}
          </svg>
          <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ opacity: 0.7 }}>
                <th style={cellStyle('left')}>{t('table.model')}</th>
                <th style={cellStyle('right')}>{t('table.total')}</th>
                <th style={cellStyle('right')}>{t('table.turns')}</th>
              </tr>
            </thead>
            <tbody>
              {pie.slices.map(slice => (
                <tr key={`${slice.row.provider}/${slice.row.model}`}>
                  <td style={cellStyle('left')}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: slice.color, marginRight: 6 }} />
                    {slice.row.model}
                    <span style={{ opacity: 0.5, marginLeft: 6 }}>{slice.row.provider}</span>
                  </td>
                  <td style={cellStyle('right')}>{counts.format(total(slice.row))} <span style={{ opacity: 0.5 }}>({(slice.share * 100).toFixed(1)}%)</span></td>
                  <td style={cellStyle('right')}>{counts.format(slice.row.turns)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      )}

      {pie !== undefined && (
        <details>
          <summary style={{ cursor: 'pointer', opacity: 0.8 }}>{t('table.title')}</summary>
          <table style={{ borderCollapse: 'collapse', fontSize: 13, marginTop: 10, width: '100%' }}>
            <thead>
              <tr style={{ opacity: 0.7 }}>
                <th style={cellStyle('left')}>{t('table.model')}</th>
                <th style={cellStyle('right')}>{t('table.input')}</th>
                <th style={cellStyle('right')}>{t('table.output')}</th>
                <th style={cellStyle('right')}>{t('table.cacheRead')}</th>
                <th style={cellStyle('right')}>{t('table.cacheWrite')}</th>
                <th style={cellStyle('right')}>{t('table.turns')}</th>
                <th style={cellStyle('right')}>{t('table.total')}</th>
              </tr>
            </thead>
            <tbody>
              {summary?.totals.map((row, index) => (
                <tr key={`${row.provider}/${row.model}`}>
                  <td style={cellStyle('left')}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: PALETTE[index % PALETTE.length], marginRight: 6 }} />
                    {row.model}
                    <span style={{ opacity: 0.5, marginLeft: 6 }}>{row.provider}</span>
                  </td>
                  <td style={cellStyle('right')}>{counts.format(row.uncachedInputTokens)}</td>
                  <td style={cellStyle('right')}>{counts.format(row.outputTokens)}</td>
                  <td style={cellStyle('right')}>{counts.format(row.cacheReadTokens)}</td>
                  <td style={cellStyle('right')}>{counts.format(row.cacheWriteTokens)}</td>
                  <td style={cellStyle('right')}>{counts.format(row.turns)}</td>
                  <td style={cellStyle('right')}>{counts.format(total(row))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  )
}

/** The curve's colour key, in the same order the bands are stacked. */
function Legend({ models, t }: { models: readonly string[], t: TranslateNS<'dshellUsage'> }): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
      {models.map((model, index) => (
        <span key={model} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: PALETTE[index % PALETTE.length] }} />
          {model}
        </span>
      ))}
      <span style={{ opacity: 0.5 }}>{t('chart.axis.tokens', { value: '' }).trim()}</span>
    </div>
  )
}

/** One table cell's alignment and padding, so the two tables match. */
function cellStyle(align: 'left' | 'right'): { textAlign: 'left' | 'right', padding: string } {
  return { textAlign: align, padding: '3px 10px 3px 0' }
}
