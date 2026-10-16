import { useEffect, useMemo, useRef, useState } from 'react'
import type { CheckItem } from '../mantle/content/schemas'
import type { Confidence } from '../mantle/store/types'
import { useMantle } from '../state/useMantle'

type Answer = string | string[] | undefined

export function grade(item: CheckItem, answer: Answer): boolean {
  if (answer === undefined) return false
  switch (item.kind) {
    case 'mcq':
      return answer === item.answer
    case 'multi': {
      const a = new Set(answer as string[])
      return a.size === item.answers.length && item.answers.every((x) => a.has(x))
    }
    case 'order':
      return (answer as string[]).join('|') === item.answer.join('|')
  }
}

/** Deterministic starting order for ordering items that is never already correct. */
function startingOrder(item: Extract<CheckItem, { kind: 'order' }>): string[] {
  const ids = item.items.map((i) => i.id)
  const seed = [...item.id].reduce((s, ch) => s + ch.charCodeAt(0), 0)
  const shuffled = [...ids].sort((a, b) => ((a.charCodeAt(0) * seed) % 7) - ((b.charCodeAt(0) * seed) % 7) || a.localeCompare(b))
  if (shuffled.join('|') === item.answer.join('|')) shuffled.push(shuffled.shift()!)
  return shuffled
}

function ItemView({
  item,
  answer,
  setAnswer,
  revealed,
}: {
  item: CheckItem
  answer: Answer
  setAnswer: (a: Answer) => void
  revealed: boolean
}) {
  if (item.kind === 'order') {
    const order = (answer as string[] | undefined) ?? startingOrder(item)
    const text = (id: string) => item.items.find((x) => x.id === id)!.text
    const move = (i: number, d: -1 | 1) => {
      const next = [...order]
      const j = i + d
      if (j < 0 || j >= next.length) return
      ;[next[i], next[j]] = [next[j], next[i]]
      setAnswer(next)
    }
    return (
      <ol className="step-list" aria-label="Put these in order. Use the buttons to move an item.">
        {order.map((id, i) => {
          const right = revealed && item.answer[i] === id
          return (
            <li key={id} className={`choice${revealed ? (right ? ' correct' : ' wrong') : ''}`} style={{ alignItems: 'center', cursor: 'default' }}>
              <span className="mono muted">{i + 1}.</span>
              <span style={{ flex: 1 }}>{text(id)}</span>
              {!revealed && (
                <span className="row" style={{ gap: 4 }}>
                  <button type="button" className="btn btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move "${text(id)}" up`}>
                    ↑
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move "${text(id)}" down`}>
                    ↓
                  </button>
                </span>
              )}
            </li>
          )
        })}
      </ol>
    )
  }

  const multi = item.kind === 'multi'
  const selected = new Set(multi ? ((answer as string[]) ?? []) : answer ? [answer as string] : [])
  const isRight = (id: string) => (item.kind === 'mcq' ? item.answer === id : item.answers.includes(id))
  return (
    <div role={multi ? 'group' : 'radiogroup'} aria-label={multi ? 'Select all that apply' : 'Choose one answer'}>
      {item.options.map((o) => {
        const checked = selected.has(o.id)
        const cls = revealed ? (isRight(o.id) ? ' correct' : checked ? ' wrong' : '') : ''
        return (
          <label key={o.id} className={`choice${cls}`}>
            <input
              type={multi ? 'checkbox' : 'radio'}
              name={item.id}
              value={o.id}
              checked={checked}
              disabled={revealed}
              onChange={() => {
                if (!multi) return setAnswer(o.id)
                const next = new Set(selected)
                if (next.has(o.id)) next.delete(o.id)
                else next.add(o.id)
                setAnswer([...next])
              }}
            />
            <span>
              {o.text}
              {revealed && (checked || isRight(o.id)) && <span className="choice-feedback">{o.feedback}</span>}
            </span>
          </label>
        )
      })}
    </div>
  )
}

export interface CheckSummary {
  correct: number
  total: number
}

/** Runs knowledge-check items one at a time; every answer is recorded as evidence. */
export function CheckRunner({
  items,
  passMark,
  onComplete,
}: {
  items: CheckItem[]
  passMark?: number
  onComplete?: (s: CheckSummary) => void | Promise<void>
}) {
  const run = useMantle((s) => s.run)
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState<Answer>(undefined)
  const [confidence, setConfidence] = useState<Confidence | undefined>(undefined)
  const [revealed, setRevealed] = useState(false)
  const [results, setResults] = useState<boolean[]>([])
  const shownAt = useRef(performance.now())
  const headingRef = useRef<HTMLHeadingElement>(null)
  const item = items[index]
  const done = index >= items.length
  const summary = useMemo(() => ({ correct: results.filter(Boolean).length, total: items.length }), [results, items.length])

  useEffect(() => {
    shownAt.current = performance.now()
    headingRef.current?.focus()
  }, [index])

  if (items.length === 0) return <p className="muted">No check items for this concept yet.</p>

  if (done) {
    const pct = summary.correct / Math.max(1, summary.total)
    const passed = passMark === undefined || pct >= passMark
    return (
      <div className={`callout ${passed ? 'callout-ok' : 'callout-warn'}`} role="status" data-testid="check-summary">
        <strong>
          {summary.correct} of {summary.total} correct ({Math.round(pct * 100)}%)
        </strong>
        {passMark !== undefined && <p>{passed ? `Passed: the bar is ${Math.round(passMark * 100)}%.` : `Not yet: the bar is ${Math.round(passMark * 100)}%. Your plan now schedules a remediation pass.`}</p>}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            setIndex(0)
            setResults([])
            setAnswer(undefined)
            setRevealed(false)
          }}
        >
          Try again
        </button>
      </div>
    )
  }

  const submit = async () => {
    const correct = grade(item, item.kind === 'order' ? ((answer as string[]) ?? startingOrder(item)) : answer)
    setRevealed(true)
    setResults((r) => [...r, correct])
    await run((rt) =>
      rt.recordAttempt({
        kind: 'check',
        itemId: item.id,
        conceptIds: [item.conceptId],
        tier: 'apply',
        depth: item.depth,
        correct,
        answer: answer ?? null,
        latencyMs: Math.round(performance.now() - shownAt.current),
        confidence,
      }),
    )
  }

  const next = async () => {
    const isLast = index === items.length - 1
    setIndex((i) => i + 1)
    setAnswer(undefined)
    setConfidence(undefined)
    setRevealed(false)
    if (isLast) await onComplete?.(summary)
  }

  const canSubmit = item.kind === 'order' || (Array.isArray(answer) ? answer.length > 0 : answer !== undefined)
  const lastCorrect = results[results.length - 1]

  return (
    <div className="stack" data-testid="check-runner">
      <div className="row spread small muted">
        <span>
          Question {index + 1} of {items.length}
        </span>
        <span>
          {item.kind === 'multi' ? 'Select all that apply' : item.kind === 'order' ? 'Put in order' : 'Choose one'} · L{item.depth}
        </span>
      </div>
      <h3 tabIndex={-1} ref={headingRef}>
        {item.stem}
      </h3>
      <ItemView item={item} answer={answer} setAnswer={setAnswer} revealed={revealed} />
      {!revealed ? (
        <>
          <fieldset>
            <legend className="small">How confident are you? (optional)</legend>
            <div className="row">
              {(['low', 'medium', 'high'] as const).map((c) => (
                <label key={c} className="row small" style={{ gap: 6, fontWeight: 400 }}>
                  <input type="radio" name={`${item.id}-confidence`} checked={confidence === c} onChange={() => setConfidence(c)} />
                  {c}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
              Check answer
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={`callout ${lastCorrect ? 'callout-ok' : 'callout-danger'}`} role="status">
            <strong>{lastCorrect ? 'Correct.' : 'Not quite.'}</strong> {item.explanation}
          </div>
          <div>
            <button type="button" className="btn btn-primary" onClick={next}>
              {index === items.length - 1 ? 'See result' : 'Next question'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
