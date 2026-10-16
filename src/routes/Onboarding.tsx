import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { Audience, Goal } from '../mantle/content/schemas'
import { useMantle } from '../state/useMantle'

const NOT_SURE = '__not-sure'

export function Onboarding() {
  const { learner, content, run } = useMantle()
  const navigate = useNavigate()
  const [step, setStep] = useState<'welcome' | 'diagnostic' | 'goal'>('welcome')
  const [q, setQ] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [goal, setGoal] = useState<Goal>('interview')
  const [role, setRole] = useState<Audience>('engineer')
  const [horizonWeeks, setHorizon] = useState(6)
  const [weeklyHours, setHours] = useState(5)
  const [busy, setBusy] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const items = content.diagnostic
  const item = items[q]

  useEffect(() => {
    headingRef.current?.focus()
  }, [step, q])

  if (step === 'welcome') {
    return (
      <div className="card stack" style={{ maxWidth: 760 }}>
        <div className="eyebrow">Welcome</div>
        <h1 tabIndex={-1} ref={headingRef}>
          Learn agentic AI system design, one lab per concept.
        </h1>
        <p className="lede">Your learner ID was created in this browser just now. There is no sign-up, and everything works offline.</p>
        <div className="callout">
          <div className="small muted">Your learner ID</div>
          <code data-testid="learner-id" style={{ fontSize: '1.05rem' }}>
            {learner?.id}
          </code>
        </div>
        <p className="small muted">
          Progress lives in this browser only. To move it to another device, export a bundle from Settings, optionally protected by a passphrase. With no bundle there
          is no recovery, because nothing is stored on a server.
        </p>
        <p>Next: a 12-question readiness check (about 6 minutes). Answer honestly, and pick "Not sure" rather than guessing. It sets your starting point.</p>
        <div>
          <button type="button" className="btn btn-primary" onClick={() => setStep('diagnostic')}>
            Start the readiness check
          </button>
        </div>
      </div>
    )
  }

  if (step === 'diagnostic') {
    const chosen = answers[item.id]
    return (
      <div className="card stack" style={{ maxWidth: 760 }} data-testid="diagnostic">
        <div className="row spread">
          <div className="eyebrow">
            Readiness check · {q + 1} of {items.length}
          </div>
          <div className="meter" style={{ width: 160 }} aria-hidden="true">
            <span style={{ width: `${((q + 1) / items.length) * 100}%` }} />
          </div>
        </div>
        <h2 tabIndex={-1} ref={headingRef}>
          {item.stem}
        </h2>
        <div role="radiogroup" aria-label="Answer">
          {[...item.options, { id: NOT_SURE, text: 'Not sure' }].map((o) => (
            <label key={o.id} className="choice">
              <input type="radio" name={item.id} checked={chosen === o.id} onChange={() => setAnswers({ ...answers, [item.id]: o.id })} />
              <span>{o.text}</span>
            </label>
          ))}
        </div>
        <div className="row">
          <button type="button" className="btn" disabled={q === 0} onClick={() => setQ(q - 1)}>
            Back
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!chosen}
            onClick={() => (q === items.length - 1 ? setStep('goal') : setQ(q + 1))}
          >
            {q === items.length - 1 ? 'Finish the check' : 'Next'}
          </button>
        </div>
      </div>
    )
  }

  const finish = async () => {
    setBusy(true)
    await run((rt) =>
      rt.completeOnboarding({ goal, role, horizonWeeks, weeklyMinutes: weeklyHours * 60, answers }),
    )
    navigate('/', { replace: true })
  }

  return (
    <div className="card stack" style={{ maxWidth: 760 }}>
      <div className="eyebrow">Almost done</div>
      <h1 tabIndex={-1} ref={headingRef}>
        What are you here for?
      </h1>
      <fieldset>
        <legend>Goal</legend>
        {(
          [
            ['interview', 'Prepare for an agentic AI system design interview'],
            ['capstone', 'Build a production agent system (capstone)'],
            ['enablement', 'Use AI safely and productively at work'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="choice">
            <input type="radio" name="goal" checked={goal === value} onChange={() => setGoal(value)} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Role</legend>
        {(
          [
            ['engineer', 'Engineer'],
            ['architect', 'Architect'],
            ['non-technical', 'Non-technical'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="choice">
            <input type="radio" name="role" checked={role === value} onChange={() => setRole(value)} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="horizon">Weeks until your goal: {horizonWeeks}</label>
          <input id="horizon" type="range" min={1} max={26} value={horizonWeeks} onChange={(e) => setHorizon(Number(e.target.value))} />
          <span className="field-help">Under 4 weeks with an interview goal fast-tracks explainers to L3.</span>
        </div>
        <div className="field">
          <label htmlFor="hours">Hours per week: {weeklyHours}</label>
          <input id="hours" type="range" min={1} max={20} value={weeklyHours} onChange={(e) => setHours(Number(e.target.value))} />
          <span className="field-help">The plan fills this budget, reserving time for flashcards first.</span>
        </div>
      </div>
      <div className="row">
        <button type="button" className="btn" onClick={() => setStep('diagnostic')}>
          Back
        </button>
        <button type="button" className="btn btn-primary" onClick={finish} disabled={busy}>
          {busy ? 'Building your plan…' : 'Build my plan'}
        </button>
      </div>
    </div>
  )
}
