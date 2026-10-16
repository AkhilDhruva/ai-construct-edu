import { useEffect, useRef, useState } from 'react'
import type { GradeJob, GradeResult } from '../mantle/api/client'
import type { Drill } from '../mantle/content/schemas'
import { useMantle } from '../state/useMantle'

const POLL_MS = 3_000
const MAX_POLLS = 40

/** API-mode rubric grading. The self-score stays the floor; this adds a second opinion. */
export function AiGrade({ drill, answer }: { drill: Drill; answer: string }) {
  const { api, can, run } = useMantle()
  const [state, setState] = useState<'idle' | 'grading' | 'queued' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<GradeResult | undefined>()
  const [error, setError] = useState<string | undefined>()
  const polls = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  if (!can('grader')) return null

  const finish = async (job: GradeJob) => {
    const r = job.result as GradeResult | { error: string } | null | undefined
    if (job.status === 'failed' || !r || 'error' in r) {
      setState('error')
      setError(r && 'error' in r ? r.error : 'Grading failed.')
      return
    }
    setResult(r)
    setState('done')
    await run((rt) =>
      rt.recordAttempt({
        kind: 'drill',
        itemId: drill.id,
        conceptIds: drill.concepts,
        tier: 'design',
        depth: 3,
        correct: r.passed,
        score: r.total / r.max,
        answer: { grader: 'ai', model: r.model, scores: Object.fromEntries(r.criteria.map((c) => [c.id, c.score])) },
        latencyMs: 0,
      }),
    )
  }

  const poll = (jobId: string) => {
    timer.current = setTimeout(async () => {
      polls.current++
      try {
        const job = await api!.gradeJob(jobId)
        if (job.status === 'done' || job.status === 'failed') await finish(job)
        else if (polls.current < MAX_POLLS) poll(jobId)
        else {
          setState('error')
          setError('The AI score is taking too long. Your self-score stands.')
        }
      } catch (e) {
        setState('error')
        setError(e instanceof Error ? e.message : String(e))
      }
    }, POLL_MS)
  }

  const start = async () => {
    setState('grading')
    setError(undefined)
    try {
      const job = await api!.gradeDrill(drill.id, answer)
      if (job.status === 'queued') {
        setState('queued')
        polls.current = 0
        poll(job.jobId)
      } else await finish(job)
    } catch (e) {
      setState('error')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <section className="card stack" aria-labelledby="ai-grade-h" data-testid="ai-grade">
      <h2 id="ai-grade-h">AI score</h2>
      <p className="small muted">
        Scored against the same rubric. Each point must quote the sentence that earned it; the server drops any point whose quote is not in your answer.
      </p>
      {state === 'idle' && (
        <div>
          <button type="button" className="btn btn-primary" onClick={start}>
            Get an AI score
          </button>
        </div>
      )}
      <div aria-live="polite">
        {state === 'grading' && <p role="status">Grading…</p>}
        {state === 'queued' && (
          <div className="callout callout-warn" role="status">
            <strong>AI score arriving later.</strong> The grader is slow right now (rung 1), so your answer is queued. Your self-score stands meanwhile.
          </div>
        )}
        {state === 'error' && (
          <div className="callout callout-warn" role="status">
            {error}
          </div>
        )}
        {result && (
          <div className="stack" data-testid="ai-grade-result">
            <div className="row spread">
              <strong className="mono">
                AI total: {result.total} / {result.max}
              </strong>
              <span className={`badge ${result.passed ? 'badge-ok' : 'badge-warn'}`}>{result.passed ? 'Pass' : `Below ${result.passMark}/${result.max}`}</span>
            </div>
            <ul className="plan-list">
              {result.criteria.map((c) => (
                <li key={c.id} className="plan-item" style={{ gridTemplateColumns: '1fr auto' }}>
                  <div>
                    <strong>{c.criterion}</strong>
                    <div className="small">{c.rationale}</div>
                    {c.citation && (
                      <blockquote className="small muted" style={{ margin: '6px 0 0', borderLeft: '3px solid var(--border)', paddingLeft: 8 }}>
                        “{c.citation}”
                      </blockquote>
                    )}
                    {c.adjusted && <div className="small" style={{ color: 'var(--danger)' }}>Point removed: the quoted sentence is not in your answer.</div>}
                  </div>
                  <span className="mono">{c.score}/3</span>
                </li>
              ))}
            </ul>
            <p className="small muted">
              {result.mock ? 'Mock grader (deterministic, no model call). ' : `Graded by ${result.model}${result.fallbackUsed ? ' (fallback model)' : ''}. `}
              {result.tokens} tokens · ${result.costUsd.toFixed(4)} · rung {result.rung}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
