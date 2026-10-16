import { useEffect, useMemo, useRef, useState } from 'react'
import { Metric, StatusBadge } from '../../ui/primitives'
import type { LabProps } from '../types'
import { applyLevers, meetsChallenge, type CostWaterfallScenario } from './schema'

const usd = (x: number, d = 4) => `$${x.toFixed(d)}`

export default function CostWaterfallLab({ scenario, onEvidence }: LabProps<CostWaterfallScenario>) {
  const [selected, setSelected] = useState<string[]>([])
  const [solved, setSolved] = useState(false)
  const startedAt = useRef(performance.now())
  const base = useMemo(() => applyLevers(scenario, []), [scenario])
  const w = useMemo(() => applyLevers(scenario, selected), [scenario, selected])
  const ok = meetsChallenge(scenario, selected)
  const c = scenario.challenge
  const max = base.usdPerTask

  useEffect(() => {
    if (!ok || solved) return
    setSolved(true)
    void onEvidence({ itemId: `${scenario.id}:challenge`, correct: true, depth: 3, answer: selected, latencyMs: Math.round(performance.now() - startedAt.current) })
  }, [ok, solved, selected, scenario.id, onEvidence])

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  return (
    <div className="stack">
      <div className="prose">
        {scenario.brief.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <div className={`callout ${solved ? 'callout-ok' : ''}`} role="status" data-testid="cw-challenge">
        {solved ? <strong>Challenge complete: under target, quality held, within the lever limit.</strong> : c.instruction}
        <div className="small muted">
          Target {usd(c.targetUsdPerTask)} per task · quality ≥ {Math.round(c.minQuality * 100)}% · at most {c.maxLevers} levers
        </div>
      </div>

      <div className="grid grid-2">
        <fieldset>
          <legend>Levers (applied in the order you pick them)</legend>
          {scenario.levers.map((l) => {
            const on = selected.includes(l.id)
            return (
              <label key={l.id} className="choice">
                <input type="checkbox" checked={on} onChange={() => toggle(l.id)} />
                <span>
                  <strong>{l.label}</strong>
                  {on && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>#{selected.indexOf(l.id) + 1}</span>}
                  <span className="choice-feedback">
                    {l.description} Quality {l.qualityDelta >= 0 ? '+' : ''}
                    {(l.qualityDelta * 100).toFixed(1)} pts.
                  </span>
                </span>
              </label>
            )
          })}
        </fieldset>

        <div className="stack" aria-live="polite">
          <div className="grid grid-3" style={{ gap: 8 }}>
            <Metric name="per task" value={usd(w.usdPerTask)} />
            <Metric name="per month" value={`$${Math.round(w.usdPerMonth).toLocaleString()}`} />
            <Metric name="quality" value={`${(w.quality * 100).toFixed(1)}%`} />
          </div>
          <div className="row">
            <StatusBadge ok={w.usdPerTask <= c.targetUsdPerTask} yes="under target" no="over target" />
            <StatusBadge ok={w.quality >= c.minQuality} yes="quality held" no="quality too low" />
            <StatusBadge ok={selected.length <= c.maxLevers} yes={`${selected.length} levers`} no={`${selected.length} levers (max ${c.maxLevers})`} />
            {w.conflicts.length > 0 && <span className="badge badge-danger">conflict: {w.conflicts.map((p) => p.join(' + ')).join(', ')}</span>}
          </div>
          <figure style={{ margin: 0 }} data-testid="waterfall">
            <div className="stack" style={{ gap: 6 }}>
              {[{ label: 'Baseline', from: max, to: 0, kind: 'total' as const }, ...w.steps.map((s) => ({ label: s.label, from: s.after + s.savedPerTask, to: s.after, kind: 'step' as const })), { label: 'Now', from: w.usdPerTask, to: 0, kind: 'total' as const }].map((row, i) => (
                <div key={i} className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
                  <span className="small" style={{ width: 130, flex: 'none' }}>
                    {row.label}
                  </span>
                  <div className="waterfall" style={{ flex: 1, height: 16, background: 'transparent' }} aria-hidden="true">
                    <span
                      style={{
                        left: `${(Math.min(row.from, row.to) / max) * 100}%`,
                        width: `${(Math.abs(row.from - row.to) / max) * 100}%`,
                        background: row.kind === 'total' ? 'var(--accent)' : 'var(--warn)',
                        borderRadius: 4,
                      }}
                    />
                  </div>
                  <span className="mono small" style={{ width: 90, textAlign: 'right', flex: 'none' }}>
                    {row.kind === 'total' ? usd(row.from) : `−${usd(row.from - row.to)}`}
                  </span>
                </div>
              ))}
              <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
                <span style={{ width: 130, flex: 'none' }} />
                <div style={{ flex: 1, position: 'relative', height: 14 }}>
                  <span className="small" style={{ position: 'absolute', left: `${(c.targetUsdPerTask / max) * 100}%`, borderLeft: '2px dashed var(--danger)', paddingLeft: 4 }}>
                    target
                  </span>
                </div>
                <span style={{ width: 90, flex: 'none' }} />
              </div>
            </div>
            <figcaption className="small muted">
              Cost per task from the baseline, one bar per lever in the order applied. Components now:{' '}
              {Object.entries(w.byComponent)
                .map(([k, v]) => `${scenario.components.find((x) => x.id === k)?.label} ${usd(v)}`)
                .join(' · ')}
              .
            </figcaption>
          </figure>
        </div>
      </div>
    </div>
  )
}
