import { useRef, useState } from 'react'
import type { LabProps } from '../types'
import { evaluate, initialState, LEGS, type Leg, type TrifectaScenario, type TrifectaState } from './schema'

const LEG_LABEL: Record<Leg, string> = {
  'private-data': 'Reads private data',
  'untrusted-content': 'Sees untrusted content',
  'external-comms': 'Can communicate externally',
}

export default function TrifectaLab({ scenario, onEvidence }: LabProps<TrifectaScenario>) {
  const [agentId, setAgentId] = useState(scenario.agents[0].id)
  const agent = scenario.agents.find((a) => a.id === agentId)!
  const [states, setStates] = useState<Record<string, TrifectaState>>({})
  const [locked, setLocked] = useState<Record<string, boolean>>({})
  const startedAt = useRef(performance.now())
  const state = states[agent.id] ?? initialState(agent)
  const result = evaluate(agent, state)
  const set = (next: TrifectaState) => setStates({ ...states, [agent.id]: next })
  const toggle = (key: keyof TrifectaState, id: string) =>
    set({ ...state, [key]: state[key].includes(id) ? state[key].filter((x) => x !== id) : [...state[key], id] })

  const lock = async () => {
    setLocked({ ...locked, [agent.id]: true })
    await onEvidence({
      itemId: `${scenario.id}:${agent.id}`,
      correct: result.safeAndUseful,
      depth: 2,
      answer: state,
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
        <label htmlFor="tf-agent">Agent</label>
        <select id="tf-agent" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          {scenario.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      </div>
      <p className="callout">
        <strong>Task:</strong> {agent.task}
      </p>

      <div className="grid grid-3" style={{ gap: 8 }} aria-live="polite" data-testid="legs">
        {LEGS.map((l) => {
          const on = result.legs.has(l)
          return (
            <div
              key={l}
              className="metric"
              style={{ borderColor: on ? 'var(--danger)' : 'var(--border)', background: on ? 'var(--danger-soft)' : 'var(--surface)', boxShadow: on && result.lethal ? '0 0 0 3px var(--danger)' : undefined }}
            >
              <span className="value" style={{ fontSize: '1rem', color: on ? 'var(--danger)' : 'var(--ok)' }}>
                {on ? '● present' : '○ broken'}
              </span>
              <span className="name">{LEG_LABEL[l]}</span>
            </div>
          )
        })}
      </div>
      <div className={`callout ${result.safeAndUseful ? 'callout-ok' : result.lethal ? 'callout-danger' : 'callout-warn'}`} role="status" data-testid="tf-status">
        <strong>
          {result.lethal
            ? 'Lethal trifecta: one injected instruction could exfiltrate private data.'
            : result.missingRequired.length
              ? 'Safe, but the task no longer works: a required tool is off.'
              : 'Trifecta broken and the task still works.'}
        </strong>
      </div>

      <div className="grid grid-2">
        <fieldset>
          <legend>Tools on this agent's identity</legend>
          {agent.tools.map((t) => (
            <label key={t.id} className="choice">
              <input type="checkbox" disabled={locked[agent.id]} checked={state.enabled.includes(t.id)} onChange={() => toggle('enabled', t.id)} />
              <span>
                <strong>{t.label}</strong> {t.required && <span className="badge badge-info">needed for the task</span>}
                <span className="choice-feedback">{t.legs.length ? t.legs.map((l) => LEG_LABEL[l]).join(' · ') : 'Adds no trifecta leg'}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Mitigations</legend>
          {agent.mitigations.map((m) => (
            <label key={m.id} className="choice">
              <input type="checkbox" disabled={locked[agent.id]} checked={state.mitigations.includes(m.id)} onChange={() => toggle('mitigations', m.id)} />
              <span>
                <strong>{m.label}</strong>
                <span className="choice-feedback">
                  {m.description} Removes “{LEG_LABEL[m.neutralises].toLowerCase()}” from: {m.appliesTo.map((id) => agent.tools.find((t) => t.id === id)?.label ?? id).join(', ')}.
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      {!locked[agent.id] ? (
        <div>
          <button type="button" className="btn btn-primary" onClick={lock}>
            Lock in this design
          </button>
        </div>
      ) : (
        <div className={`callout ${result.safeAndUseful ? 'callout-ok' : 'callout-warn'}`} role="status" data-testid="tf-verdict">
          <strong>{result.safeAndUseful ? 'Safe and useful.' : 'Not yet safe and useful.'}</strong> {agent.debrief}
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => setLocked({ ...locked, [agent.id]: false })}>
              Revise
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
