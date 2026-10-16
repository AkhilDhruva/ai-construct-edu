import { useRef, useState } from 'react'
import type { LabProps } from '../types'
import { scoreSort, type SortingBoardScenario } from './schema'

export default function SortingBoardLab({ scenario, onEvidence }: LabProps<SortingBoardScenario>) {
  const [placed, setPlaced] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState(false)
  const startedAt = useRef(performance.now())
  const result = scoreSort(scenario, placed)
  const bucket = (id: string) => scenario.buckets.find((b) => b.id === id)
  const allPlaced = scenario.items.every((i) => placed[i.id])

  const check = async () => {
    setChecked(true)
    await onEvidence({
      itemId: `${scenario.id}:sort`,
      correct: result.passed,
      depth: 2,
      answer: placed,
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
      <div className="grid grid-3" style={{ gap: 8 }}>
        {scenario.buckets.map((b) => (
          <div key={b.id} className="metric" style={{ alignContent: 'start' }}>
            <strong>{b.label}</strong>
            <span className="name">{b.description}</span>
            <span className="small mono" aria-label={`${scenario.items.filter((i) => placed[i.id] === b.id).length} items placed in ${b.label}`}>
              {scenario.items.filter((i) => placed[i.id] === b.id).length} placed
            </span>
          </div>
        ))}
      </div>
      <ol className="plan-list" data-testid="sort-items">
        {scenario.items.map((item) => {
          const ok = checked ? placed[item.id] === item.bucket : undefined
          return (
            <li key={item.id} className="plan-item" style={{ gridTemplateColumns: '1fr minmax(160px, 220px)', borderColor: ok === undefined ? undefined : ok ? 'var(--ok)' : 'var(--danger)' }}>
              <div>
                <div>{item.text}</div>
                {checked && (
                  <div className="small" style={{ marginTop: 4 }}>
                    <span className={`badge ${ok ? 'badge-ok' : 'badge-danger'}`}>{ok ? 'Right' : `Belongs in: ${bucket(item.bucket)?.label}`}</span> {item.explanation}
                  </div>
                )}
              </div>
              <select aria-label={`Bucket for: ${item.text}`} value={placed[item.id] ?? ''} disabled={checked} onChange={(e) => setPlaced({ ...placed, [item.id]: e.target.value })}>
                <option value="" disabled>
                  Choose…
                </option>
                {scenario.buckets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </li>
          )
        })}
      </ol>
      {!checked ? (
        <div>
          <button type="button" className="btn btn-primary" disabled={!allPlaced} onClick={check}>
            Check my sorting
          </button>
        </div>
      ) : (
        <div className={`callout ${result.passed ? 'callout-ok' : 'callout-warn'}`} role="status" data-testid="sort-result">
          <strong>
            {result.correct} of {result.total} placed correctly.
          </strong>{' '}
          {result.passed ? 'Passed.' : `The bar is ${Math.round(scenario.passScore * 100)}%. Read the explanations, then try again.`}
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setChecked(false)
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
