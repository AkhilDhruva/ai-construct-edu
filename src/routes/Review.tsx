import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { ReviewRating } from '../mantle/cards/scheduler'
import { useMantle } from '../state/useMantle'
import { DepthBadge } from '../ui/primitives'

const RATINGS: Array<{ r: ReviewRating; label: string; key: string }> = [
  { r: 'again', label: 'Again', key: '1' },
  { r: 'hard', label: 'Hard', key: '2' },
  { r: 'good', label: 'Good', key: '3' },
  { r: 'easy', label: 'Easy', key: '4' },
]

export function Review() {
  const { due, content, run } = useMantle()
  const [flipped, setFlipped] = useState(false)
  const [reviewed, setReviewed] = useState(0)
  const shownAt = useRef(performance.now())
  const state = due[0]
  const card = state ? content.cards.get(state.cardId) : undefined

  useEffect(() => {
    shownAt.current = performance.now()
    setFlipped(false)
  }, [state?.cardId])

  const rate = async (r: ReviewRating) => {
    if (!card) return
    const latency = Math.round(performance.now() - shownAt.current)
    await run((rt) => rt.reviewCard(card.id, r, latency))
    setReviewed((n) => n + 1)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || (e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.key === ' ' && !flipped) {
        e.preventDefault()
        setFlipped(true)
      } else if (flipped) {
        const hit = RATINGS.find((x) => x.key === e.key)
        if (hit) void rate(hit.r)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!card) {
    return (
      <div className="card stack" style={{ maxWidth: 680 }}>
        <h1>{reviewed > 0 ? 'Review done for now' : 'No cards due'}</h1>
        <p className="muted">
          {reviewed > 0 ? `You reviewed ${reviewed} card${reviewed === 1 ? '' : 's'}. ` : ''}Cards enter review when you open a concept's explainer, and come back on
          a spaced schedule (FSRS).
        </p>
        <Link className="btn btn-primary" to="/">
          Back to your plan
        </Link>
      </div>
    )
  }

  const concept = content.concepts.get(card.conceptId)
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="row spread">
        <div>
          <div className="eyebrow">Review · {due.length} due</div>
          <h1 className="small muted" style={{ fontSize: '1rem' }}>
            {concept?.title}
          </h1>
        </div>
        <DepthBadge depth={card.depth} />
      </div>
      <div className="card flashcard" data-testid="flashcard" aria-live="polite">
        <div>
          <p style={{ fontWeight: 600 }}>{card.front}</p>
          {flipped && (
            <>
              <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '16px 0' }} />
              <p>{card.back}</p>
            </>
          )}
        </div>
      </div>
      {!flipped ? (
        <button type="button" className="btn btn-primary" onClick={() => setFlipped(true)}>
          Show answer <span className="small">(space)</span>
        </button>
      ) : (
        <div className="row" role="group" aria-label="How well did you recall it?">
          {RATINGS.map(({ r, label, key }) => (
            <button key={r} type="button" className={`btn${r === 'good' ? ' btn-primary' : ''}`} onClick={() => rate(r)}>
              {label} <span className="small">({key})</span>
            </button>
          ))}
        </div>
      )}
      <p className="small muted">
        "Again" on an L2 or L3 card also brings back the concept's L1 cards. Ratings feed your mastery: a lapse lowers it by a small, bounded step.
      </p>
    </div>
  )
}
