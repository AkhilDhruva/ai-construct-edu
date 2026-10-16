import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BudgetGauge } from '../../ui/primitives'
import type { LabProps } from '../types'
import type { Bounds, SequenceStepperScenario } from './schema'
import { BOUND_REASONS, REASON_LABEL, simulate, type TerminationReason } from './simulate'

const BOUND_LABEL: Record<keyof Bounds, string> = {
  maxSteps: 'Step ceiling',
  tokenBudget: 'Token budget',
  wallClockSec: 'Wall clock (s)',
  noProgressWindow: 'No-progress window',
}
const REASON_FOR_BOUND: Record<keyof Bounds, TerminationReason> = {
  maxSteps: 'step-ceiling',
  tokenBudget: 'token-budget',
  wallClockSec: 'wall-clock',
  noProgressWindow: 'no-progress',
}
const OUTCOMES: TerminationReason[] = ['completed', ...BOUND_REASONS]
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : String(n))
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`

function Simulator({ scenario }: { scenario: SequenceStepperScenario }) {
  const reduced = useReducedMotion()
  const [traceId, setTraceId] = useState(scenario.traces[0].id)
  const [bounds, setBounds] = useState<Bounds>(scenario.defaults)
  const [shown, setShown] = useState(0)
  const [playing, setPlaying] = useState(false)
  const trace = scenario.traces.find((t) => t.id === traceId)!
  const sim = useMemo(() => simulate(trace, bounds), [trace, bounds])
  const finished = shown >= sim.frames.length
  const frame = shown > 0 ? sim.frames[shown - 1] : undefined

  useEffect(() => {
    setShown(0)
    setPlaying(false)
  }, [traceId, bounds])

  useEffect(() => {
    if (!playing) return
    if (finished) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setShown((s) => s + 1), reduced ? 150 : 550)
    return () => clearTimeout(t)
  }, [playing, shown, finished, reduced])

  const used = {
    steps: frame?.stepsUsed ?? 0,
    tokens: frame?.tokensUsed ?? 0,
    ms: frame?.elapsedMs ?? 0,
    stall: frame?.noProgressRun ?? 0,
  }
  const fired = finished ? sim.reason : undefined
  const refused = finished && sim.reason !== 'completed' && sim.reason !== 'no-progress' ? trace.steps[sim.stoppedAt] : undefined

  return (
    <div className="grid grid-2">
      <div className="stack">
        <div className="field">
          <label htmlFor="trace">Recorded trace</label>
          <select id="trace" value={traceId} onChange={(e) => setTraceId(e.target.value)}>
            {scenario.traces.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          <span className="field-help">{trace.description}</span>
        </div>
        <fieldset>
          <legend>Bounds</legend>
          <div className="stack">
            {(Object.keys(BOUND_LABEL) as Array<keyof Bounds>).map((key) => {
              const r = scenario.ranges[key]
              return (
                <div className="field" key={key}>
                  <label htmlFor={`b-${key}`} className="row spread">
                    <span>{BOUND_LABEL[key]}</span>
                    <span className="mono">{key === 'tokenBudget' ? k(bounds[key]) : bounds[key]}</span>
                  </label>
                  <input
                    id={`b-${key}`}
                    type="range"
                    min={r.min}
                    max={r.max}
                    step={r.step}
                    value={bounds[key]}
                    onChange={(e) => setBounds({ ...bounds, [key]: Number(e.target.value) })}
                  />
                </div>
              )
            })}
            <button type="button" className="btn btn-sm" onClick={() => setBounds(scenario.defaults)}>
              Reset to defaults
            </button>
          </div>
        </fieldset>
      </div>

      <div className="stack">
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => (finished ? (setShown(0), setPlaying(true)) : setPlaying((p) => !p))}>
            {playing ? 'Pause' : finished ? 'Replay' : 'Run'}
          </button>
          <button type="button" className="btn" disabled={finished || playing} onClick={() => setShown((s) => s + 1)}>
            Step
          </button>
          <button type="button" className="btn" disabled={finished} onClick={() => (setPlaying(false), setShown(sim.frames.length))}>
            Skip to end
          </button>
        </div>
        <div className="card stack" style={{ padding: 16 }}>
          <BudgetGauge label="Steps" used={used.steps} limit={bounds.maxSteps} tripped={fired === 'step-ceiling'} />
          <BudgetGauge label="Tokens" used={used.tokens} limit={bounds.tokenBudget} format={k} tripped={fired === 'token-budget'} />
          <BudgetGauge label="Wall clock" used={used.ms} limit={bounds.wallClockSec * 1000} format={secs} tripped={fired === 'wall-clock'} />
          <BudgetGauge label="Steps without progress" used={used.stall} limit={bounds.noProgressWindow} tripped={fired === 'no-progress'} />
        </div>
        <div aria-live="polite">
          {fired && (
            <motion.div
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`callout ${fired === 'completed' ? 'callout-ok' : 'callout-danger'}`}
              data-testid="termination"
            >
              <strong>Termination: {fired}</strong>
              <div>{REASON_LABEL[fired]}.</div>
              {refused && (
                <div className="small">
                  Refused before running: <code>{refused.label}</code>
                </div>
              )}
            </motion.div>
          )}
        </div>
        <ol className="step-list" aria-label="Steps executed">
          <AnimatePresence initial={false}>
            {sim.frames.slice(0, shown).map((f) => (
              <motion.li
                key={f.index}
                className={`step${f.step.progress ? '' : ' stalled'}`}
                initial={reduced ? false : { opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
              >
                <span className="mono muted">{f.index + 1}</span>
                <span className="kind">{f.step.kind}</span>
                <span className="label">
                  {f.step.label}
                  {!f.step.progress && <span className="muted"> · no new information</span>}
                </span>
                <span className="row small" style={{ gap: 6 }}>
                  {f.step.result && <span className={`badge ${f.step.result === 'SUCCESS' ? 'badge-ok' : 'badge-warn'}`}>{f.step.result}</span>}
                  <span className="mono muted">
                    +{k(f.step.tokens)} · {secs(f.step.ms)}
                  </span>
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      </div>
    </div>
  )
}

function Challenge({ scenario, onEvidence }: Pick<LabProps<SequenceStepperScenario>, 'scenario' | 'onEvidence'>) {
  const traces = scenario.challenge.traceIds.map((id) => scenario.traces.find((t) => t.id === id)!)
  const [guess, setGuess] = useState<Record<string, TerminationReason>>({})
  const [submitted, setSubmitted] = useState(false)
  const startedAt = useRef(performance.now())
  const truth = Object.fromEntries(traces.map((t) => [t.id, simulate(t, scenario.defaults).reason]))
  const score = traces.filter((t) => guess[t.id] === truth[t.id]).length

  const submit = async () => {
    setSubmitted(true)
    const latencyMs = Math.round((performance.now() - startedAt.current) / traces.length)
    for (const t of traces) {
      await onEvidence({ itemId: `bounded-loop-sim:${t.id}`, correct: guess[t.id] === truth[t.id], depth: 2, answer: guess[t.id], latencyMs })
    }
  }

  return (
    <div className="stack" data-testid="loop-challenge">
      <p>{scenario.challenge.instruction}</p>
      {traces.map((t) => (
        <fieldset key={t.id}>
          <legend>{t.title}</legend>
          <p className="small muted">{t.description}</p>
          <div className="grid grid-3" style={{ gap: 8 }}>
            {OUTCOMES.map((o) => {
              const state = submitted ? (o === truth[t.id] ? ' correct' : guess[t.id] === o ? ' wrong' : '') : ''
              return (
                <label key={o} className={`choice${state}`} style={{ marginTop: 0 }}>
                  <input type="radio" name={`predict-${t.id}`} disabled={submitted} checked={guess[t.id] === o} onChange={() => setGuess({ ...guess, [t.id]: o })} />
                  <span className="small">{o}</span>
                </label>
              )
            })}
          </div>
        </fieldset>
      ))}
      {!submitted ? (
        <button type="button" className="btn btn-primary" disabled={traces.some((t) => !guess[t.id])} onClick={submit}>
          Lock in predictions
        </button>
      ) : (
        <div className={`callout ${score === traces.length ? 'callout-ok' : 'callout-warn'}`} role="status">
          <strong>
            {score} of {traces.length} predicted correctly.
          </strong>{' '}
          Run each trace above with the default bounds to watch the gauge that fires.
          <div className="row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setGuess({})
                setSubmitted(false)
                startedAt.current = performance.now()
              }}
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SequenceStepperLab({ scenario, onEvidence }: LabProps<SequenceStepperScenario>) {
  const [tab, setTab] = useState<'explore' | 'challenge'>('explore')
  return (
    <div>
      <div className="prose">
        {scenario.brief.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <div className="tabs" role="tablist" aria-label="Lab mode">
        <button role="tab" aria-selected={tab === 'explore'} onClick={() => setTab('explore')}>
          Explore
        </button>
        <button role="tab" aria-selected={tab === 'challenge'} onClick={() => setTab('challenge')}>
          Challenge: predict the bound
        </button>
      </div>
      <div role="tabpanel">{tab === 'explore' ? <Simulator scenario={scenario} /> : <Challenge scenario={scenario} onEvidence={onEvidence} />}</div>
      <p className="small muted" style={{ marginTop: 16 }}>
        Each bound has its own reason code ({Object.values(REASON_FOR_BOUND).join(', ')}). A run that stops on a bound is expected behaviour, not a crash.
      </p>
    </div>
  )
}
