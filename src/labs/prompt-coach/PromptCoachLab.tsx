import { useMemo, useRef, useState } from 'react'
import { useMantle } from '../../state/useMantle'
import type { LabProps } from '../types'
import { analyzePrompt, diffWords } from './analyze'
import type { PromptCoachScenario } from './schema'

function Diff({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffWords(before, after), [before, after])
  return (
    <p className="diff" aria-label="Changes from the weak prompt to the strong prompt">
      {parts.map((p, i) =>
        p.kind === 'same' ? (
          <span key={i}>{p.text}</span>
        ) : p.kind === 'added' ? (
          <ins key={i}>{p.text}</ins>
        ) : (
          <del key={i}>{p.text}</del>
        ),
      )}
    </p>
  )
}

export default function PromptCoachLab({ scenario, onEvidence }: LabProps<PromptCoachScenario>) {
  const flags = useMantle((s) => s.flags)
  const [scenarioId, setScenarioId] = useState(scenario.scenarios[0].id)
  const current = scenario.scenarios.find((s) => s.id === scenarioId)!
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({})
  const startedAt = useRef(performance.now())
  const text = drafts[scenarioId] ?? current.weakPrompt
  const analysis = useMemo(() => analyzePrompt(text, scenario), [text, scenario])
  const done = submitted[scenarioId]

  const submit = async () => {
    setSubmitted({ ...submitted, [scenarioId]: true })
    await onEvidence({
      itemId: `prompt-coach:${scenarioId}`,
      correct: analysis.passed,
      depth: 2,
      answer: { text, score: analysis.score, redFlags: analysis.redFlags.map((f) => f.id) },
      latencyMs: Math.round(performance.now() - startedAt.current),
    })
  }

  return (
    <div className="stack">
      <div className="prose">
        {scenario.brief.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <div className="field" style={{ maxWidth: 420 }}>
        <label htmlFor="pc-scenario">Workplace task</label>
        <select
          id="pc-scenario"
          value={scenarioId}
          onChange={(e) => {
            setScenarioId(e.target.value)
            startedAt.current = performance.now()
          }}
        >
          {scenario.scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </div>
      <p className="callout">{current.situation}</p>

      <div className="grid grid-2">
        <div className="stack">
          <div className="field">
            <label htmlFor="pc-prompt">Your prompt</label>
            <textarea
              id="pc-prompt"
              style={{ minHeight: 200 }}
              value={text}
              readOnly={done}
              onChange={(e) => setDrafts({ ...drafts, [scenarioId]: e.target.value })}
              aria-describedby="pc-help"
            />
            <span id="pc-help" className="field-help">
              Starts as the weak prompt. Rewrite it so it covers {scenario.elements.map((e) => e.label).join(', ')}. {analysis.words} words.
            </span>
          </div>
          {!done ? (
            <div>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={analysis.words < 5}>
                Submit to the coach
              </button>
            </div>
          ) : (
            <div className={`callout ${analysis.passed ? 'callout-ok' : 'callout-warn'}`} role="status" data-testid="coach-result">
              <strong>{analysis.passed ? 'Strong prompt.' : 'Not there yet.'}</strong>{' '}
              {analysis.passed ? 'It covers the elements and carries no sensitive data.' : 'Compare with the exemplar below, then try again.'}
              <div style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-sm" onClick={() => setSubmitted({ ...submitted, [scenarioId]: false })}>
                  Edit again
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="card stack" style={{ padding: 16 }} aria-live="polite">
          <div className="row spread">
            <h3 style={{ margin: 0 }}>Coach</h3>
            <span className={`badge ${analysis.passed ? 'badge-ok' : 'badge-warn'}`} data-testid="coach-score">
              {Math.round(analysis.score * 100)}% of elements
            </span>
          </div>
          <ul className="plan-list">
            {analysis.elements.map((e) => (
              <li key={e.id} className="plan-item" style={{ gridTemplateColumns: 'auto 1fr' }}>
                <span className={`badge ${e.present ? 'badge-ok' : 'badge-danger'}`}>{e.present ? '✓' : '✗'}</span>
                <div>
                  <strong>{e.label}</strong>
                  {!e.present && <div className="small">{e.tip}</div>}
                </div>
              </li>
            ))}
          </ul>
          {analysis.redFlags.map((f) => (
            <div key={f.id} className="callout callout-danger small" role="alert">
              <strong>{f.label}.</strong> {f.advice}
            </div>
          ))}
          <p className="small muted">
            {flags?.coach
              ? 'Live coach available: ask for a rewrite with an explanation.'
              : 'Offline coach: pattern checks only. Live rewrites arrive with API mode; this checklist stays as the floor.'}
          </p>
        </div>
      </div>

      {done && (
        <section className="card stack" aria-labelledby="pc-exemplar">
          <h3 id="pc-exemplar">Before and after</h3>
          <Diff before={current.weakPrompt} after={current.strongPrompt} />
          <ul>
            {current.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
