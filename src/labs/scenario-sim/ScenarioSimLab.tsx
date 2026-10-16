import { useRef, useState } from 'react'
import type { LabProps } from '../types'
import { scorePath, type ChoiceQuality, type ScenarioSimScenario } from './schema'

const QUALITY_BADGE: Record<ChoiceQuality, string> = { best: 'badge-ok', acceptable: 'badge-info', risky: 'badge-danger' }

interface Taken {
  stepId: string
  prompt: string
  choice: string
  quality: ChoiceQuality
  outcome: string
}

export default function ScenarioSimLab({ scenario, onEvidence }: LabProps<ScenarioSimScenario>) {
  const [scenarioId, setScenarioId] = useState(scenario.scenarios[0].id)
  const current = scenario.scenarios.find((s) => s.id === scenarioId)!
  const [stepId, setStepId] = useState<string | undefined>(current.start)
  const [path, setPath] = useState<Taken[]>([])
  const startedAt = useRef(performance.now())
  const step = current.steps.find((s) => s.id === stepId)
  const finished = stepId === undefined
  const result = scorePath(path.map((p) => p.quality))

  const reset = (id = scenarioId) => {
    const sc = scenario.scenarios.find((s) => s.id === id)!
    setScenarioId(id)
    setStepId(sc.start)
    setPath([])
    startedAt.current = performance.now()
  }

  const choose = async (choiceId: string) => {
    const c = step!.choices.find((x) => x.id === choiceId)!
    const nextPath = [...path, { stepId: step!.id, prompt: step!.prompt, choice: c.text, quality: c.quality, outcome: c.outcome }]
    setPath(nextPath)
    setStepId(c.next)
    if (!c.next) {
      const r = scorePath(nextPath.map((p) => p.quality))
      await onEvidence({
        itemId: `workplace-scenario:${scenarioId}`,
        correct: r.passed,
        depth: 2,
        answer: nextPath.map((p) => ({ step: p.stepId, quality: p.quality })),
        latencyMs: Math.round(performance.now() - startedAt.current),
      })
    }
  }

  return (
    <div className="stack">
      <div className="prose">
        {scenario.brief.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <div className="field" style={{ maxWidth: 420 }}>
        <label htmlFor="ss-scenario">Scenario</label>
        <select id="ss-scenario" value={scenarioId} onChange={(e) => reset(e.target.value)}>
          {scenario.scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </div>
      <p className="callout">{current.setting}</p>

      {path.length > 0 && (
        <ol className="plan-list" aria-label="Your choices so far">
          {path.map((p, i) => (
            <li key={i} className="plan-item" style={{ gridTemplateColumns: '1fr auto' }}>
              <div>
                <div className="small muted">{p.prompt}</div>
                <div>
                  <strong>You:</strong> {p.choice}
                </div>
                <div className="small" style={{ marginTop: 4 }}>
                  {p.outcome}
                </div>
              </div>
              <span className={`badge ${QUALITY_BADGE[p.quality]}`}>{p.quality}</span>
            </li>
          ))}
        </ol>
      )}

      {step && (
        <fieldset data-testid="scenario-step">
          <legend>{step.prompt}</legend>
          {step.choices.map((c) => (
            <button key={c.id} type="button" className="choice" style={{ width: '100%', textAlign: 'left', font: 'inherit' }} onClick={() => choose(c.id)}>
              {c.text}
            </button>
          ))}
        </fieldset>
      )}

      {finished && (
        <div className={`callout ${result.passed ? 'callout-ok' : 'callout-warn'}`} role="status" data-testid="scenario-result">
          <strong>{result.passed ? 'Handled safely.' : `${result.risky} risky choice${result.risky === 1 ? '' : 's'} on this path.`}</strong> {current.debrief}
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => reset()}>
              Replay this scenario
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
