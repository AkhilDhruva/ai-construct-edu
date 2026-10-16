import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { RUNG_INFO } from '../mantle/session/rung'
import { useMantle } from '../state/useMantle'
import { usePackage } from './usePackage'

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

export function Drill() {
  const pkg = usePackage()
  const { drill: drillId } = useParams()
  const { run, rung, flags } = useMantle()
  const drill = pkg?.drills.find((d) => d.id === drillId)
  const draftKey = `mantle:drill-draft:${drillId}`
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(draftKey) ?? ''
    } catch {
      return ''
    }
  })
  const [left, setLeft] = useState((drill?.minutes ?? 45) * 60)
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<'write' | 'score' | 'done'>('write')
  const [scores, setScores] = useState<Record<string, number>>({})
  const startedAt = useRef<number | undefined>(undefined)

  useEffect(() => {
    try {
      localStorage.setItem(draftKey, text)
    } catch {
      /* drafts are a convenience only */
    }
  }, [draftKey, text])

  useEffect(() => {
    if (!running || left <= 0) return
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [running, left])

  if (!pkg || !drill) return <p>Unknown drill.</p>
  const total = Object.values(scores).reduce((s, v) => s + v, 0)
  const allScored = drill.rubric.every((r) => scores[r.id] !== undefined)
  const passed = total >= drill.passMark

  const submitScore = async () => {
    await run((rt) =>
      rt.recordAttempt({
        kind: 'drill',
        itemId: drill.id,
        conceptIds: drill.concepts,
        tier: 'design',
        depth: 3,
        correct: passed,
        score: total / 12,
        answer: { text, scores, grader: 'self' },
        latencyMs: startedAt.current ? Date.now() - startedAt.current : 0,
      }),
    )
    setPhase('done')
  }

  return (
    <div className="stack">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Plan</Link> / <Link to={pkg.manifest.route}>{pkg.manifest.title}</Link> / {drill.title}
      </nav>
      <div>
        <div className="eyebrow">Design drill · {drill.minutes} minutes · pass at {drill.passMark}/12</div>
        <h1>{drill.title}</h1>
      </div>
      <div className="card stack">
        <p className="prose">{drill.prompt}</p>
        <div className="row spread">
          <div className="row">
            <span className="mono" style={{ fontSize: '1.5rem' }} role="timer" aria-live="off">
              {fmt(left)}
            </span>
            {phase === 'write' && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  startedAt.current ??= Date.now()
                  setRunning((r) => !r)
                }}
              >
                {running ? 'Pause timer' : left < drill.minutes * 60 ? 'Resume timer' : 'Start timer'}
              </button>
            )}
          </div>
          {left === 0 && <span className="badge badge-warn">Time is up: finish your sentence and score it</span>}
        </div>
        <div className="field">
          <label htmlFor="answer">Your design</label>
          <textarea
            id="answer"
            value={text}
            readOnly={phase !== 'write'}
            onChange={(e) => setText(e.target.value)}
            placeholder="Requirements as numbers → architecture and the rule that picked it → the trade-off you accept → the measurement that would prove you wrong."
          />
          <span className="field-help">Saved in this browser as you type.</span>
        </div>
        {phase === 'write' && (
          <div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={text.trim().length < 40}
              onClick={() => {
                setRunning(false)
                setPhase('score')
              }}
            >
              Done: score my answer
            </button>
          </div>
        )}
      </div>

      {phase !== 'write' && (
        <section className="card stack" aria-labelledby="rubric-h">
          <h2 id="rubric-h">Score against the rubric</h2>
          <div className="callout small">
            {flags?.grader
              ? 'The AI grader will also score this and cite the sentence that earned each point.'
              : `AI grading is unavailable at rung ${rung} (${RUNG_INFO[rung].label}). Self-score honestly: the rubric is the same one the grader uses.`}
          </div>
          {drill.rubric.map((r) => (
            <fieldset key={r.id}>
              <legend>{r.criterion}</legend>
              {r.levels.map((level, score) => (
                <label key={score} className="choice">
                  <input
                    type="radio"
                    name={r.id}
                    disabled={phase === 'done'}
                    checked={scores[r.id] === score}
                    onChange={() => setScores({ ...scores, [r.id]: score })}
                  />
                  <span>
                    <strong className="mono">{score}</strong> {level}
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
          <div className="row spread">
            <strong className="mono">Total: {total} / 12</strong>
            {phase === 'score' ? (
              <button type="button" className="btn btn-primary" disabled={!allScored} onClick={submitScore}>
                Record score
              </button>
            ) : (
              <span className={`badge ${passed ? 'badge-ok' : 'badge-warn'}`}>{passed ? 'Pass' : 'Below the 9/12 bar'}</span>
            )}
          </div>
          {phase === 'done' && (
            <details open>
              <summary>Shape of a strong answer</summary>
              <ol>
                {drill.outline.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ol>
            </details>
          )}
        </section>
      )}
    </div>
  )
}
