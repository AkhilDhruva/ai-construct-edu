import { motion, useReducedMotion } from 'framer-motion'
import { useMemo, useRef, useState } from 'react'
import type { LabProps } from '../types'
import { HAZARD_LABEL, runPipeline, type StageEvent } from './run'
import type { GatewayPipelineScenario, StageId } from './schema'

const OUTCOME_BADGE: Record<StageEvent['outcome'], string> = { pass: 'badge-ok', stop: 'badge-warn', ran: 'badge-info', skipped: 'badge-neutral' }

export default function GatewayPipelineLab({ scenario, onEvidence }: LabProps<GatewayPipelineScenario>) {
  const reduced = useReducedMotion()
  const [order, setOrder] = useState<StageId[]>(scenario.startOrder)
  const [callId, setCallId] = useState(scenario.calls[0].id)
  const [recorded, setRecorded] = useState(false)
  const startedAt = useRef(performance.now())
  const stage = (id: StageId) => scenario.stages.find((s) => s.id === id)!
  const runs = useMemo(
    () => scenario.calls.map((c) => ({ call: c, run: runPipeline(order, c, scenario.tool.allowedPrincipals, scenario.timeoutMs) })),
    [order, scenario],
  )
  const selected = runs.find((r) => r.call.id === callId)!
  const correct = runs.filter((r) => r.run.result === r.call.expected && r.run.hazards.length === 0).length
  const allCorrect = correct === runs.length

  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    setOrder(next)
    setRecorded(false)
  }

  const record = async () => {
    setRecorded(true)
    await onEvidence({
      itemId: 'gateway-walkthrough:order',
      correct: allCorrect,
      depth: 2,
      answer: order,
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
      <div className="callout small">
        <strong>
          Tool <code>{scenario.tool.name}</code>
        </strong>
        : {scenario.tool.description} Arguments: <code>{scenario.tool.argsSchema}</code>. Allowed: {scenario.tool.allowedPrincipals.join(', ')}. Timeout {scenario.timeoutMs} ms.
      </div>

      <div className="grid grid-2">
        <fieldset>
          <legend>Gateway stages, in the order they run</legend>
          <ol className="step-list" data-testid="stage-order">
            {order.map((id, i) => (
              <motion.li key={id} layout={!reduced} className="step" style={{ gridTemplateColumns: '2.5ch 1fr auto' }}>
                <span className="mono muted">{i + 1}</span>
                <span>
                  <strong>{stage(id).label}</strong>
                  <span className="small muted" style={{ display: 'block' }}>
                    {stage(id).description}
                  </span>
                </span>
                <span className="row" style={{ gap: 4 }}>
                  <button type="button" className="btn btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${stage(id).label} up`}>
                    ↑
                  </button>
                  <button type="button" className="btn btn-sm" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${stage(id).label} down`}>
                    ↓
                  </button>
                </span>
              </motion.li>
            ))}
          </ol>
          <p className="small" style={{ marginTop: 12 }}>
            {scenario.challenge.instruction}
          </p>
          <div className="row">
            <span className={`badge ${allCorrect ? 'badge-ok' : 'badge-warn'}`} data-testid="gateway-score">
              {correct} of {runs.length} calls correct and safe
            </span>
            <button type="button" className="btn btn-primary btn-sm" onClick={record} disabled={recorded}>
              {recorded ? 'Recorded' : 'Lock in this order'}
            </button>
          </div>
        </fieldset>

        <div className="stack">
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Every sample call through the current order</caption>
              <thead>
                <tr>
                  <th scope="col">Call</th>
                  <th scope="col">Result</th>
                  <th scope="col">Expected</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(({ call, run }) => {
                  const ok = run.result === call.expected && run.hazards.length === 0
                  return (
                    <tr key={call.id}>
                      <td>
                        <button type="button" className="btn btn-sm" onClick={() => setCallId(call.id)} aria-pressed={call.id === callId}>
                          {call.title}
                        </button>
                      </td>
                      <td>
                        <span className={`badge ${ok ? 'badge-ok' : 'badge-danger'}`}>
                          {run.result}
                          {run.hazards.length ? ` · ${run.hazards.length} hazard${run.hazards.length > 1 ? 's' : ''}` : ''}
                        </span>
                      </td>
                      <td className="mono">{call.expected}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="card stack" style={{ padding: 16 }} aria-live="polite" data-testid="call-trace">
            <div className="small muted">
              {selected.call.principal} → <code>{scenario.tool.name}({selected.call.args})</code>
            </div>
            <ol className="step-list">
              {selected.run.events.map((e, i) => (
                <li key={i} className="step" style={{ gridTemplateColumns: '2.5ch auto 1fr' }}>
                  <span className="mono muted">{i + 1}</span>
                  <span className={`badge ${OUTCOME_BADGE[e.outcome]}`}>{stage(e.stage).label}</span>
                  <span className="small">{e.note}</span>
                </li>
              ))}
            </ol>
            {selected.run.hazards.map((h) => (
              <div key={h} className="callout callout-danger small">
                {HAZARD_LABEL[h]}
              </div>
            ))}
            <div>
              Caller receives: <strong className="mono">{selected.run.result === 'RAW' ? 'raw upstream text' : selected.run.result}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
