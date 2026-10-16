import { useMemo, useRef, useState } from 'react'
import type { LabProps } from '../types'
import { asOf, type BitemporalScenario } from './schema'

const DAY = 86_400_000
const toDay = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY)
const fromDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10)
const PALETTE = ['var(--accent)', 'var(--info)', 'var(--warn)', 'var(--danger)', 'var(--ok)', 'var(--text-muted)']

const COLS = 90
const ROWS = 45

/**
 * Valid time on the x axis, system (recorded) time on the y axis. Each region is
 * coloured by the fact the as-of query returns there, so the chart is exactly what the
 * system would answer; the crosshair is the current question.
 */
function Chart({ s, validAt, knownAt }: { s: BitemporalScenario; validAt: string; knownAt: string }) {
  const W = 640
  const H = 300
  const pad = 36
  const d0 = toDay(s.axis.start)
  const d1 = toDay(s.axis.end)
  const x = (d: string | null) => pad + ((Math.min(d1, d ? toDay(d) : d1) - d0) / (d1 - d0)) * (W - 2 * pad)
  const y = (d: string | null) => H - pad - ((Math.min(d1, d ? toDay(d) : d1) - d0) / (d1 - d0)) * (H - 2 * pad)
  const cellW = (W - 2 * pad) / COLS
  const cellH = (H - 2 * pad) / ROWS
  const index = new Map(s.facts.map((f, i) => [f.id, i]))
  const regions = useMemo(() => {
    // One rect per horizontal run of cells that share a winning fact.
    const out: Array<{ x: number; y: number; w: number; h: number; fact: string }> = []
    const widest = new Map<string, { x: number; y: number; w: number }>()
    for (let r = 0; r < ROWS; r++) {
      const known = fromDay(Math.round(d0 + ((r + 0.5) / ROWS) * (d1 - d0)))
      let runStart = 0
      let runFact: string | undefined
      for (let c = 0; c <= COLS; c++) {
        const fact = c < COLS ? asOf(s.facts, fromDay(Math.round(d0 + ((c + 0.5) / COLS) * (d1 - d0))), known)?.id : undefined
        if (c < COLS && fact === runFact) continue
        if (runFact) {
          out.push({ x: pad + runStart * cellW, y: H - pad - (r + 1) * cellH, w: (c - runStart) * cellW, h: cellH, fact: runFact })
          // Label each fact on its widest run, which always lies inside its own region.
          const w = (c - runStart) * cellW
          if (w > (widest.get(runFact)?.w ?? 0)) widest.set(runFact, { x: pad + runStart * cellW + w / 2, y: H - pad - (r + 0.5) * cellH, w })
        }
        runStart = c
        runFact = fact
      }
    }
    return { rects: out, labels: [...widest.entries()].map(([fact, l]) => ({ fact, x: l.x, y: l.y + 4 })) }
  }, [s.facts, d0, d1, cellW, cellH])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Bitemporal chart of ${s.subject}. Valid time runs left to right, recorded time bottom to top.`}>
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--border)" />
      <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="var(--border)" />
      <text x={W - pad} y={H - 8} textAnchor="end" fontSize="11" fill="var(--text-muted)">
        valid time (true in the world) →
      </text>
      <text x={8} y={pad - 12} fontSize="11" fill="var(--text-muted)">
        ↑ recorded time (known to the system)
      </text>
      {regions.rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w + 0.5} height={r.h + 0.5} fill={PALETTE[(index.get(r.fact) ?? 0) % PALETTE.length]} fillOpacity={0.28} shapeRendering="crispEdges" />
      ))}
      {regions.labels.map((l) => (
        <text key={l.fact} x={l.x} y={l.y} fontSize="11" textAnchor="middle" fill="var(--text)" style={{ paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 3 }}>
          {l.fact}
        </text>
      ))}
      <line x1={x(validAt)} y1={pad} x2={x(validAt)} y2={H - pad} stroke="var(--text)" strokeDasharray="4 3" />
      <line x1={pad} y1={y(knownAt)} x2={W - pad} y2={y(knownAt)} stroke="var(--text)" strokeDasharray="4 3" />
      <circle cx={x(validAt)} cy={y(knownAt)} r={5} fill="var(--text)" />
    </svg>
  )
}

export default function BitemporalLab({ scenario, onEvidence }: LabProps<BitemporalScenario>) {
  const d0 = toDay(scenario.axis.start)
  const d1 = toDay(scenario.axis.end)
  const [validAt, setValidAt] = useState(scenario.questions[0].validAt)
  const [knownAt, setKnownAt] = useState(scenario.questions[0].knownAt)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState(false)
  const startedAt = useRef(performance.now())
  const hit = useMemo(() => asOf(scenario.facts, validAt, knownAt), [scenario.facts, validAt, knownAt])
  const score = scenario.questions.filter((q) => answers[q.id] === q.answer).length
  const passed = score / scenario.questions.length >= 0.8

  const check = async () => {
    setChecked(true)
    await onEvidence({ itemId: `${scenario.id}:as-of`, correct: passed, depth: 2, answer: answers, latencyMs: Math.round(performance.now() - startedAt.current) })
  }

  return (
    <div className="stack">
      <div className="prose">
        {scenario.brief.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <div className="grid grid-2">
        <div className="stack">
          <Chart s={scenario} validAt={validAt} knownAt={knownAt} />
          {(['valid', 'known'] as const).map((which) => {
            const value = which === 'valid' ? validAt : knownAt
            return (
              <div className="field" key={which}>
                <label htmlFor={`bt-${which}`} className="row spread">
                  <span>{which === 'valid' ? 'Moment in the world (valid time)' : 'What the system knew by (recorded time)'}</span>
                  <span className="mono">{value}</span>
                </label>
                <input
                  id={`bt-${which}`}
                  type="range"
                  min={d0}
                  max={d1}
                  value={toDay(value)}
                  onChange={(e) => (which === 'valid' ? setValidAt : setKnownAt)(fromDay(Number(e.target.value)))}
                />
              </div>
            )
          })}
          <div className="callout" aria-live="polite" data-testid="as-of-result">
            As of <span className="mono">{knownAt}</span>, the system believed {scenario.subject.toLowerCase()} on <span className="mono">{validAt}</span> was:{' '}
            <strong>{hit ? `${hit.value} (${hit.id})` : 'nothing recorded'}</strong>
            {hit && <div className="small muted">{hit.note}</div>}
          </div>
        </div>
        <div className="stack">
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Every recorded fact with its valid and recorded times</caption>
              <thead>
                <tr>
                  <th scope="col">Fact</th>
                  <th scope="col">Value</th>
                  <th scope="col">Valid</th>
                  <th scope="col">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {scenario.facts.map((f) => (
                  <tr key={f.id}>
                    <td className="mono">{f.id}</td>
                    <td>{f.value}</td>
                    <td className="mono small">
                      {f.validFrom} → {f.validTo ?? 'now'}
                    </td>
                    <td className="mono small">
                      {f.recordedAt} → {f.supersededAt ?? 'now'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <section className="stack" aria-labelledby="bt-q">
        <h3 id="bt-q">As-of questions</h3>
        {scenario.questions.map((q) => {
          const ok = checked ? answers[q.id] === q.answer : undefined
          return (
            <fieldset key={q.id}>
              <legend>{q.prompt}</legend>
              <div className="row">
                {[...scenario.facts.map((f) => ({ id: f.id, label: `${f.id}: ${f.value}` })), { id: 'none', label: 'Nothing recorded' }].map((o) => (
                  <label key={o.id} className={`choice${checked && o.id === q.answer ? ' correct' : checked && answers[q.id] === o.id ? ' wrong' : ''}`} style={{ marginTop: 0 }}>
                    <input type="radio" name={`q-${q.id}`} disabled={checked} checked={answers[q.id] === o.id} onChange={() => setAnswers({ ...answers, [q.id]: o.id })} />
                    <span className="small">{o.label}</span>
                  </label>
                ))}
              </div>
              <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => (setValidAt(q.validAt), setKnownAt(q.knownAt))}>
                Show this point on the chart
              </button>
              {ok !== undefined && <p className="small" style={{ marginTop: 6 }}>{q.explanation}</p>}
            </fieldset>
          )
        })}
        {!checked ? (
          <div>
            <button type="button" className="btn btn-primary" disabled={scenario.questions.some((q) => !answers[q.id])} onClick={check}>
              Check my answers
            </button>
          </div>
        ) : (
          <div className={`callout ${passed ? 'callout-ok' : 'callout-warn'}`} role="status" data-testid="bt-result">
            <strong>
              {score} of {scenario.questions.length} correct.
            </strong>{' '}
            Move the two sliders apart: the same moment can have different answers depending on when you ask.
          </div>
        )}
      </section>
    </div>
  )
}
