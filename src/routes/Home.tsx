import { Link } from 'react-router'
import { useMantle } from '../state/useMantle'
import { DepthBadge, MasteryBar } from '../ui/primitives'
import { ProgressRadar } from '../ui/ProgressRadar'

export function Home() {
  const { plan, due, content, mastery, learner } = useMantle()
  const T = content.rules.masteryThreshold
  const m = (id: string) => mastery[id] ?? content.rules.bkt.prior
  const route = (tentacleId: string) => content.packages.find((p) => p.manifest.id === tentacleId)?.manifest.route ?? '/'
  const next = plan?.items[0]
  const week = plan?.items.filter((i) => i.thisWeek) ?? []
  const later = plan?.items.filter((i) => !i.thisWeek) ?? []

  return (
    <div className="stack">
      <div>
        <div className="eyebrow">Your plan · v{plan?.version ?? 0}</div>
        <h1>{next ? `Next up: ${next.title}` : 'Everything here is mastered'}</h1>
        <p className="lede">
          Goal: {learner?.goal} in {learner?.horizonWeeks} weeks · {Math.round((learner?.weeklyMinutes ?? 0) / 60)} h per week · role: {learner?.role}
        </p>
      </div>

      <div className="grid grid-3">
        <div className="card stack">
          <div className="eyebrow">1 · Clear due cards (about 5 min)</div>
          <p>
            <strong className="mono" style={{ fontSize: '1.6rem' }}>
              {due.length}
            </strong>{' '}
            card{due.length === 1 ? '' : 's'} due today
          </p>
          <Link className={`btn ${due.length ? 'btn-primary' : ''}`} to="/review">
            {due.length ? 'Start review' : 'Nothing due'}
          </Link>
        </div>
        <div className="card stack">
          <div className="eyebrow">2 · Take the next concept (about 15 min)</div>
          {next ? (
            <>
              <p>
                <strong>{next.title}</strong> <DepthBadge depth={next.depth} />
              </p>
              <Link className="btn btn-primary" to={`${route(next.tentacleId)}/c/${next.conceptId}`} data-testid="next-concept">
                Open explainer
              </Link>
            </>
          ) : (
            <p className="muted">No concepts left. Try a design drill.</p>
          )}
        </div>
        <div className="card stack">
          <div className="eyebrow">3 · See your trace</div>
          <p className="muted small">Every step you take is a span, so your session renders like an agent run.</p>
          <Link className="btn" to="/trace">
            Open trace
          </Link>
        </div>
      </div>

      {plan && plan.changes.length > 0 && (
        <div className="callout" role="status">
          <strong>Why your plan changed (v{plan.version}):</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {plan.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-2">
        <section className="card stack" aria-labelledby="week-h">
          <div className="row spread">
            <h2 id="week-h">This week</h2>
            <span className="small muted">
              {plan?.reservedCardMinutes ? `${Math.round(plan.reservedCardMinutes)} min reserved for cards` : ''}
            </span>
          </div>
          <ol className="plan-list" data-testid="plan-week">
            {week.map((item, i) => (
              <li key={item.conceptId} className="plan-item">
                <span className="index">{i + 1}</span>
                <div>
                  <Link to={`${route(item.tentacleId)}/c/${item.conceptId}`}>
                    <strong>{item.title}</strong>
                  </Link>{' '}
                  {item.remediation && <span className="badge badge-warn">remediation</span>}
                  <ul>
                    {item.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
                <div className="stack" style={{ minWidth: 120 }}>
                  <DepthBadge depth={item.depth} />
                  <MasteryBar value={m(item.conceptId)} label={`Mastery of ${item.title}`} />
                  <span className="small muted">{item.minutes} min</span>
                </div>
              </li>
            ))}
          </ol>
          {later.length > 0 && (
            <details>
              <summary>Later ({later.length})</summary>
              <ol className="plan-list" style={{ marginTop: 8 }}>
                {later.map((item, i) => (
                  <li key={item.conceptId} className="plan-item later">
                    <span className="index">{week.length + i + 1}</span>
                    <div>
                      <Link to={`${route(item.tentacleId)}/c/${item.conceptId}`}>{item.title}</Link>
                      <div className="small muted">{item.reasons[0]}</div>
                    </div>
                    <DepthBadge depth={item.depth} />
                  </li>
                ))}
              </ol>
            </details>
          )}
          {plan && plan.mastered.length > 0 && (
            <p className="small muted">
              Mastered (≥ {T}): {plan.mastered.map((id) => content.concepts.get(id)?.title ?? id).join(', ')}
            </p>
          )}
        </section>

        <section className="card" aria-labelledby="radar-h">
          <h2 id="radar-h">Progress</h2>
          <ProgressRadar />
        </section>
      </div>

      <section aria-labelledby="tentacles-h">
        <h2 id="tentacles-h">Tentacles</h2>
        <div className="grid grid-3">
          {content.packages.map((p) => {
            const avg = p.concepts.reduce((s, c) => s + m(c.id), 0) / p.concepts.length
            return (
              <Link key={p.manifest.id} to={p.manifest.route} className="card stack" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="eyebrow">{p.manifest.bookSource}</div>
                <h3>{p.manifest.title}</h3>
                <p className="small muted">{p.manifest.summary}</p>
                <MasteryBar value={avg} label={`${p.manifest.title} mastery`} />
              </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}
