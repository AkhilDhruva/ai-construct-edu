import { useEffect, useMemo, useRef, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { Metric, StatusBadge } from '../../ui/primitives'
import type { LabProps } from '../types'
import { computeEnvelope } from './envelope'
import type { EightNumbers, EightNumbersScenario } from './schema'

const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toLocaleString(undefined, { maximumFractionDigits: d }) : '∞')

function ReliabilityCurve({ p, steps, target }: { p: number; steps: number; target: number }) {
  const max = Math.max(30, steps + 5)
  const data = Array.from({ length: max }, (_, i) => ({ n: i + 1, s: Math.pow(p, i + 1) }))
  return (
    <figure style={{ margin: 0 }}>
      <div style={{ width: '100%', height: 200 }} aria-hidden="true">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -16 }} accessibilityLayer={false}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="n" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
            <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
            <ReferenceLine y={target} stroke="var(--warn)" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="s" stroke="var(--accent)" dot={false} strokeWidth={2} isAnimationActive={false} />
            <ReferenceDot x={steps} y={Math.pow(p, steps)} r={5} fill="var(--accent)" stroke="var(--surface)" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="small muted">
        End-to-end success against step count at {num(p * 100, 1)}% per step. The dashed line is the {num(target * 100, 0)}% target; the dot is your design at {steps} steps (
        {num(Math.pow(p, steps) * 100, 1)}%).
      </figcaption>
    </figure>
  )
}

export default function EightNumbersLab({ scenario, onEvidence }: LabProps<EightNumbersScenario>) {
  const [presetId, setPresetId] = useState(scenario.presets[0].id)
  const preset = scenario.presets.find((p) => p.id === presetId)!
  const [values, setValues] = useState<EightNumbers>(preset.values)
  const [challenge, setChallenge] = useState(false)
  const [solved, setSolved] = useState(false)
  const startedAt = useRef(performance.now())
  const env = useMemo(() => computeEnvelope(values, scenario.constants, preset.successTarget), [values, scenario.constants, preset.successTarget])
  const allOk = env.checks.every((c) => c.ok)

  const load = (id: string) => {
    setPresetId(id)
    setValues(scenario.presets.find((p) => p.id === id)!.values)
  }

  const startChallenge = () => {
    load(scenario.challenge.presetId)
    setChallenge(true)
    setSolved(false)
    startedAt.current = performance.now()
  }

  useEffect(() => {
    if (!challenge || solved || !allOk) return
    setSolved(true)
    void onEvidence({
      itemId: 'design-console:challenge',
      correct: true,
      depth: 3,
      answer: values,
      latencyMs: Math.round(performance.now() - startedAt.current),
    })
  }, [challenge, solved, allOk, values, onEvidence])

  return (
    <div className="stack">
      <div className="prose">
        {scenario.brief.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      <div className="row">
        <div className="field" style={{ minWidth: 240 }}>
          <label htmlFor="preset">Scenario</label>
          <select id="preset" value={presetId} disabled={challenge} onChange={(e) => load(e.target.value)}>
            {scenario.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
        {!challenge ? (
          <button type="button" className="btn btn-primary" onClick={startChallenge} style={{ alignSelf: 'end' }}>
            Start the challenge
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => setChallenge(false)} style={{ alignSelf: 'end' }}>
            Leave challenge
          </button>
        )}
      </div>
      <p className="muted">
        {preset.story} Requirement: task success ≥ {num(preset.successTarget * 100, 0)}%.
      </p>
      {challenge && (
        <div className={`callout ${solved ? 'callout-ok' : ''}`} role="status" data-testid="console-challenge">
          {solved ? <strong>Challenge complete: every check passes with the requirements unchanged.</strong> : scenario.challenge.instruction}
        </div>
      )}

      <div className="grid grid-2">
        <fieldset>
          <legend>The eight numbers</legend>
          <div className="stack">
            {(['requirement', 'design'] as const).map((role) => (
              <div key={role} className="stack">
                <div className="eyebrow">{role === 'requirement' ? 'Requirements (what the business asks for)' : 'Design (what your architecture does)'}</div>
                {scenario.fields
                  .filter((f) => f.role === role)
                  .map((f) => {
                    const locked = challenge && f.role === 'requirement'
                    return (
                      <div className="field" key={f.key}>
                        <label htmlFor={`f-${f.key}`} className="row spread">
                          <span>
                            {f.label}
                            {locked && <span className="badge badge-neutral" style={{ marginLeft: 8 }}>locked</span>}
                          </span>
                          <span className="mono">
                            {num(values[f.key], 3)} {f.unit}
                          </span>
                        </label>
                        <input
                          id={`f-${f.key}`}
                          type="range"
                          min={f.min}
                          max={f.max}
                          step={f.step}
                          value={values[f.key]}
                          disabled={locked}
                          aria-describedby={`h-${f.key}`}
                          onChange={(e) => setValues({ ...values, [f.key]: Number(e.target.value) })}
                        />
                        <span id={`h-${f.key}`} className="field-help">
                          {f.help}
                        </span>
                      </div>
                    )
                  })}
              </div>
            ))}
          </div>
        </fieldset>

        <div className="stack">
          <div className="card stack" style={{ padding: 16 }} aria-live="polite">
            <div className="row spread">
              <h3 style={{ margin: 0 }}>Operating envelope</h3>
              <StatusBadge ok={allOk} yes="fits" no={`${env.checks.filter((c) => !c.ok).length} failing`} />
            </div>
            <ul className="plan-list">
              {env.checks.map((c) => (
                <li key={c.id} className="plan-item" style={{ gridTemplateColumns: '1fr auto' }} data-testid={`check-${c.id}`}>
                  <div>
                    <strong>{c.label}</strong>
                    <div className="small muted">
                      {c.actual} (target {c.target})
                    </div>
                    {!c.ok && <div className="small">{c.fix}</div>}
                  </div>
                  <StatusBadge ok={c.ok} yes="pass" no="fail" />
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-3" style={{ gap: 8 }}>
            <Metric name="peak arrivals / s" value={num(env.peakArrivalsPerSec)} />
            <Metric name="peak concurrency (Little's law)" value={num(env.peakConcurrency, 1)} />
            <Metric name="mean task time" value={`${num(env.meanTaskSec, 1)} s`} />
            <Metric name="tokens per task" value={num(env.tokensPerTask, 0)} />
            <Metric name="cost per task" value={`$${num(env.costPerTask, 4)}`} />
            <Metric name="cost per day" value={`$${num(env.dailyCost, 0)}`} />
          </div>
          <ReliabilityCurve p={values.stepSuccess} steps={values.stepsPerTask} target={preset.successTarget} />
          <div className="callout small">
            Suggested loop bounds for this design: step ceiling <strong>{env.suggestedBounds.maxSteps}</strong>, token budget{' '}
            <strong>{num(env.suggestedBounds.tokenBudget, 0)}</strong>, wall clock <strong>{env.suggestedBounds.wallClockSec} s</strong>. Price assumption: $
            {scenario.constants.pricePerMTok} per million tokens (illustrative).
          </div>
        </div>
      </div>
    </div>
  )
}
