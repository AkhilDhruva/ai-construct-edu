import { Link } from 'react-router'
import { useMantle } from '../state/useMantle'
import { DepthBadge, MasteryBar } from '../ui/primitives'
import { usePackage } from './usePackage'

export function Tentacle() {
  const pkg = usePackage()
  const { content, mastery, plan, attempts, rt, learner } = useMantle()
  if (!pkg) return <p>Unknown tentacle.</p>
  const { manifest } = pkg
  const T = content.rules.masteryThreshold
  const m = (id: string) => mastery[id] ?? content.rules.bkt.prior
  const topo = (rt?.graph.topo ?? []).filter((id) => pkg.concepts.some((c) => c.id === id))
  const planned = new Map(plan?.items.map((i) => [i.conceptId, i]))
  const mastered = pkg.concepts.filter((c) => m(c.id) >= T).length
  const checkRuns = attempts.filter((a) => a.itemId === `knowledge-check:${manifest.id}`)
  const best = checkRuns.reduce((b, a) => Math.max(b, a.score), -1)
  const drillRuns = (id: string) => attempts.filter((a) => a.kind === 'drill' && a.itemId === id)

  return (
    <div className="stack">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Plan</Link> / {manifest.title}
      </nav>
      <div>
        <div className="eyebrow">
          Tentacle · {manifest.bookSource} · v{manifest.version}
        </div>
        <h1>{manifest.title}</h1>
        <p className="lede">{manifest.summary}</p>
        <p className="small muted">
          {mastered} of {pkg.concepts.length} concepts mastered · about {Math.round(manifest.estimatedMinutes / 60)} hours in total
        </p>
      </div>

      <section className="card stack" aria-labelledby="concepts-h">
        <h2 id="concepts-h">Concepts</h2>
        <p className="small muted">Each route runs explainer, then lab, then check. Order follows the prerequisite graph.</p>
        <ol className="plan-list">
          {topo.map((id, i) => {
            const c = pkg.concepts.find((x) => x.id === id)!
            const item = planned.get(id)
            return (
              <li key={id} className="plan-item">
                <span className="index">{i + 1}</span>
                <div>
                  <Link to={`${manifest.route}/c/${id}`}>
                    <strong>{c.title}</strong>
                  </Link>
                  <div className="small muted">{c.point}</div>
                </div>
                <div className="stack" style={{ minWidth: 130 }}>
                  {m(id) >= T ? <span className="badge badge-ok">mastered</span> : item ? <DepthBadge depth={item.depth} /> : null}
                  <MasteryBar value={m(id)} label={`Mastery of ${c.title}`} />
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      <div className="grid grid-2">
        <section className="card stack" aria-labelledby="labs-h">
          <h2 id="labs-h">Labs</h2>
          {manifest.labs.map((l) => (
            <Link key={l.id} to={`${manifest.route}/lab/${l.id}`} className="plan-item" style={{ gridTemplateColumns: '1fr auto', textDecoration: 'none', color: 'inherit' }}>
              <div>
                <strong>{l.title}</strong>
                <div className="small muted">Teaches: {l.concepts.map((c) => content.concepts.get(c)?.title).join(', ')}</div>
              </div>
              <span className="badge badge-neutral">{l.engine}</span>
            </Link>
          ))}
        </section>

        <section className="card stack" aria-labelledby="check-h">
          <h2 id="check-h">Knowledge check</h2>
          <p>
            {pkg.checks.length} items · pass at {Math.round(manifest.passMark * 100)}%
          </p>
          {best >= 0 && (
            <p>
              Best so far: <strong className="mono">{Math.round(best * 100)}%</strong>{' '}
              {best >= manifest.passMark ? <span className="badge badge-ok">passed</span> : <span className="badge badge-warn">not yet</span>}
            </p>
          )}
          <Link className="btn btn-primary" to={`${manifest.route}/check`}>
            {best >= 0 ? 'Retake the check' : 'Take the check'}
          </Link>
        </section>
      </div>

      {learner?.role !== 'non-technical' && pkg.drills.length > 0 && (
      <section className="card stack" aria-labelledby="drills-h">
        <h2 id="drills-h">Design drills</h2>
        <p className="small muted">Timed, open-ended, scored against a four-criterion rubric. 9 of 12 passes.</p>
        <div className="grid grid-2">
          {pkg.drills.map((d) => {
            const runs = drillRuns(d.id)
            const top = runs.reduce((b, a) => Math.max(b, Math.round(a.score * 12)), -1)
            return (
              <Link key={d.id} to={`${manifest.route}/drill/${d.id}`} className="plan-item" style={{ gridTemplateColumns: '1fr auto', textDecoration: 'none', color: 'inherit' }}>
                <div>
                  <strong>{d.title}</strong>
                  <div className="small muted">{d.minutes} minutes</div>
                </div>
                {top >= 0 ? <span className={`badge ${top >= d.passMark ? 'badge-ok' : 'badge-warn'}`}>best {top}/12</span> : <span className="badge badge-neutral">not tried</span>}
              </Link>
            )
          })}
        </div>
      </section>
      )}
    </div>
  )
}
