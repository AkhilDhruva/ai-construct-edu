import { useMemo, useRef, useState } from 'react'
import type { LabProps } from '../types'
import { costHeat, spanTree, type TraceDebuggerScenario } from './schema'

const STATUS_BADGE = { ok: 'badge-ok', error: 'badge-danger', slow: 'badge-warn', empty: 'badge-warn' } as const

export default function TraceDebuggerLab({ scenario, onEvidence }: LabProps<TraceDebuggerScenario>) {
  const [traceId, setTraceId] = useState(scenario.traces[0].id)
  const trace = scenario.traces.find((t) => t.id === traceId)!
  const [selected, setSelected] = useState<string | undefined>()
  const [verdicts, setVerdicts] = useState<Record<string, string>>({})
  const startedAt = useRef(performance.now())
  const rows = useMemo(() => spanTree(trace.spans), [trace])
  const heat = useMemo(() => costHeat(trace.spans), [trace])
  const end = Math.max(...trace.spans.map((s) => s.startMs + s.durationMs), 1)
  const span = trace.spans.find((s) => s.id === selected)
  const verdict = verdicts[trace.id]
  const totalCost = trace.spans.reduce((a, s) => a + s.costUsd, 0)
  const totalTokens = trace.spans.reduce((a, s) => a + s.tokens, 0)

  const blame = async () => {
    if (!selected) return
    setVerdicts({ ...verdicts, [trace.id]: selected })
    await onEvidence({
      itemId: `${scenario.id}:${trace.id}`,
      correct: selected === trace.rootCause,
      depth: 2,
      answer: selected,
      latencyMs: Math.round(performance.now() - startedAt.current),
    })
    startedAt.current = performance.now()
  }

  return (
    <div className="stack">
      <div className="prose">
        {scenario.brief.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <div className="field" style={{ maxWidth: 420 }}>
        <label htmlFor="td-trace">Trace</label>
        <select
          id="td-trace"
          value={traceId}
          onChange={(e) => {
            setTraceId(e.target.value)
            setSelected(undefined)
          }}
        >
          {scenario.traces.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
              {verdicts[t.id] ? (verdicts[t.id] === t.rootCause ? ' ✓' : ' ✗') : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="callout callout-warn">
        <strong>Symptom:</strong> {trace.symptom}
        <div className="small muted">
          {trace.spans.length} spans · {totalTokens.toLocaleString()} tokens · ${totalCost.toFixed(4)} · {(end / 1000).toFixed(1)} s
        </div>
      </div>

      <div className="table-wrap">
        <table data-testid="span-table">
          <caption className="sr-only">Span tree. Select a span to inspect it.</caption>
          <thead>
            <tr>
              <th scope="col">Span</th>
              <th scope="col">Status</th>
              <th scope="col" style={{ minWidth: 140 }}>
                Timeline
              </th>
              <th scope="col">Tokens</th>
              <th scope="col">Cost (heat)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} style={{ background: s.id === selected ? 'var(--accent-soft)' : undefined }}>
                <td style={{ paddingLeft: 10 + s.depth * 18 }}>
                  <button type="button" className="btn btn-sm" aria-pressed={s.id === selected} onClick={() => setSelected(s.id)} style={{ fontFamily: 'var(--mono)' }}>
                    {s.name}
                  </button>
                  <span className="kind" style={{ marginLeft: 6 }}>
                    {s.kind}
                  </span>
                </td>
                <td>
                  <span className={`badge ${STATUS_BADGE[s.status]}`}>{s.status}</span>
                </td>
                <td>
                  <div className="waterfall" role="img" aria-label={`starts at ${s.startMs} ms, lasts ${s.durationMs} ms`}>
                    <span style={{ left: `${(s.startMs / end) * 100}%`, width: `${Math.max(0.8, (s.durationMs / end) * 100)}%` }} />
                  </div>
                </td>
                <td className="mono">{s.tokens.toLocaleString()}</td>
                <td className="mono">
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 6, background: 'var(--danger)', opacity: 0.15 + 0.85 * (heat.get(s.id) ?? 0) }} aria-hidden="true" />
                  ${s.costUsd.toFixed(4)} ({Math.round((heat.get(s.id) ?? 0) * 100)}%)
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {span && (
        <div className="card stack" style={{ padding: 16 }} aria-live="polite" data-testid="span-detail">
          <div className="row spread">
            <strong className="mono">{span.name}</strong>
            <span className={`badge ${STATUS_BADGE[span.status]}`}>{span.status}</span>
          </div>
          <dl className="small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: 0 }}>
            {Object.entries(span.attributes).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt className="mono muted">{k}</dt>
                <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{String(v)}</dd>
              </div>
            ))}
          </dl>
          {!verdict && (
            <div>
              <button type="button" className="btn btn-primary" onClick={blame}>
                This span is the root cause
              </button>
            </div>
          )}
        </div>
      )}

      {verdict && (
        <div className={`callout ${verdict === trace.rootCause ? 'callout-ok' : 'callout-warn'}`} role="status" data-testid="td-verdict">
          <strong>{verdict === trace.rootCause ? 'Found it.' : `Not quite: the root cause is ${trace.spans.find((s) => s.id === trace.rootCause)?.name}.`}</strong> {trace.explanation}
        </div>
      )}
    </div>
  )
}
