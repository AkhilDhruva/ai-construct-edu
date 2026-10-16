import { useState } from 'react'
import { Link } from 'react-router'
import type { TutorAnswer } from '../mantle/api/client'
import { RUNG_INFO } from '../mantle/session/rung'
import { useMantle } from '../state/useMantle'

/**
 * "Ask the tutor why" — API mode only. The tutor is a bounded loop over read-only tools
 * scoped to this learner; the answer shows its own trace (steps, tool results, tokens,
 * termination reason), the same shape the Foundations lab teaches.
 */
export function TutorPanel({ conceptId, labId, labState }: { conceptId?: string; labId?: string; labState?: unknown }) {
  const { api, can, run, apiUrl, account, rung } = useMantle()
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<TutorAnswer | undefined>()
  const [error, setError] = useState<string | undefined>()

  if (!apiUrl) return null
  if (!can('tutor')) {
    return (
      <section className="card small muted" aria-labelledby="tutor-h" data-testid="tutor-off">
        <h2 id="tutor-h" style={{ fontSize: '1rem' }}>
          Ask the tutor
        </h2>
        {account ? `The tutor is off at rung ${rung} (${RUNG_INFO[rung].label}).` : <>Sign in from <Link to="/settings">Settings</Link> to ask the AI tutor.</>}
      </section>
    )
  }

  const ask = async () => {
    if (!api) return
    setBusy(true)
    setError(undefined)
    try {
      const res = await api.askTutor({ question, conceptId, labId, labState })
      setAnswer(res)
      await run((rt) =>
        rt.span('tutor.ask', { termination: res.termination, steps: res.steps.length, tokens: res.tokens, cost: res.costUsd, remoteRung: res.rung }, { progress: true, tokens: 0 }),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack" aria-labelledby="tutor-h" data-testid="tutor-panel">
      <h2 id="tutor-h">Ask the tutor why</h2>
      <div className="field">
        <label htmlFor="tutor-q">Your question</label>
        <textarea id="tutor-q" style={{ minHeight: 90 }} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Why did the token budget fire before the step ceiling?" />
      </div>
      <div>
        <button type="button" className="btn btn-primary" disabled={busy || question.trim().length < 3} onClick={ask}>
          {busy ? 'Thinking…' : 'Ask'}
        </button>
      </div>
      <div aria-live="polite">
        {error && (
          <div className="callout callout-warn" role="status">
            {error}
          </div>
        )}
        {answer && (
          <div className="stack" data-testid="tutor-answer">
            <p className="prose" style={{ whiteSpace: 'pre-wrap' }}>
              {answer.answer}
            </p>
            <div className="row small">
              <span className={`badge ${answer.termination === 'completed' ? 'badge-ok' : 'badge-warn'}`}>termination: {answer.termination}</span>
              <span className="badge badge-neutral">
                {answer.steps.length} step{answer.steps.length === 1 ? '' : 's'} · {answer.tokens} tokens · ${answer.costUsd.toFixed(4)}
              </span>
              <span className="badge badge-neutral">rung {answer.rung}</span>
              {answer.mock && <span className="badge badge-info">mock model</span>}
            </div>
            <ol className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              {answer.steps.map((s, i) => (
                <li key={i}>{s.kind === 'tool' ? `${s.tool} → ${s.status}` : 'answer'}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  )
}
