import { useEffect, useState } from 'react'
import type { TelemetryEvent } from '../mantle/store/types'
import { useMantle } from '../state/useMantle'

interface SessionView {
  id: string
  root?: TelemetryEvent
  end?: TelemetryEvent
  spans: TelemetryEvent[]
  startMs: number
  endMs: number
}

function group(events: TelemetryEvent[]): SessionView[] {
  const by = new Map<string, TelemetryEvent[]>()
  for (const e of events) by.set(e.sessionId, [...(by.get(e.sessionId) ?? []), e])
  return [...by.entries()]
    .map(([id, evs]) => {
      evs.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
      const root = evs.find((e) => e.name === 'session.start')
      const end = evs.find((e) => e.name === 'session.end')
      const spans = evs.filter((e) => e !== root && e !== end)
      const startMs = Date.parse(root?.start ?? evs[0].start)
      const endMs = Math.max(...evs.map((e) => Date.parse(e.start) + e.durationMs), startMs + 1)
      return { id, root, end, spans, startMs, endMs }
    })
    .sort((a, b) => b.startMs - a.startMs)
}

const attrs = (e: TelemetryEvent) =>
  Object.entries(e.attributes)
    .filter(([k]) => !['rung', 'tokens', 'cost'].includes(k))
    .map(([k, v]) => `${k}=${v}`)
    .join(' · ')

export function Trace() {
  const { rt, attempts } = useMantle()
  const [sessions, setSessions] = useState<SessionView[]>([])
  useEffect(() => {
    if (!rt) return
    void rt.store.events.query({ learnerId: rt.learner.id }).then((e) => setSessions(group(e)))
  }, [rt, attempts.length])

  return (
    <div className="stack">
      <div>
        <div className="eyebrow">Observability</div>
        <h1>Your learning trace</h1>
        <p className="lede">
          Each session is a bounded loop with a root span. Every learner step is a child span carrying the rung, tokens and cost. A session ends with a typed
          reason, just like the agents you are learning to build.
        </p>
      </div>
      {sessions.map((s, i) => {
        const span = s.endMs - s.startMs
        return (
          <details key={s.id} className="card" open={i === 0}>
            <summary className="row spread" style={{ cursor: 'pointer' }}>
              <span>
                <strong>Session {sessions.length - i}</strong> <span className="mono small muted">{s.id}</span>
              </span>
              <span className="row small">
                <span>{new Date(s.startMs).toLocaleString()}</span>
                <span className="badge badge-neutral">{s.spans.length} spans</span>
                {s.end ? (
                  <span className="badge badge-warn">ended: {String(s.end.attributes.reason)}</span>
                ) : (
                  <span className="badge badge-ok">{i === 0 ? 'active' : 'open'}</span>
                )}
              </span>
            </summary>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">+time</th>
                    <th scope="col">Span</th>
                    <th scope="col">Attributes</th>
                    <th scope="col">Rung</th>
                    <th scope="col" style={{ minWidth: 140 }}>
                      Timeline
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.spans.map((e) => {
                    const offset = Date.parse(e.start) - s.startMs
                    return (
                      <tr key={e.id}>
                        <td className="mono">{(offset / 1000).toFixed(1)}s</td>
                        <td className="mono">{e.name}</td>
                        <td className="small muted" style={{ overflowWrap: 'anywhere' }}>
                          {attrs(e)}
                        </td>
                        <td className="mono">{String(e.attributes.rung)}</td>
                        <td>
                          <div className="waterfall" role="img" aria-label={`${e.name} at ${(offset / 1000).toFixed(1)} seconds, ${e.durationMs} ms`}>
                            <span style={{ left: `${(offset / span) * 100}%`, width: `${Math.max(0.5, (e.durationMs / span) * 100)}%` }} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </details>
        )
      })}
    </div>
  )
}
